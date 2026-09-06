import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import './style.css';

// Leaflet のデフォルトマーカーアイコンのパス解決設定
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

document.addEventListener('DOMContentLoaded', () => {

// ==========================================
    // 1. 地図の初期化 (確実に表示されるOpenStreetMap ＋ 文字非表示)
    // ==========================================
    let currentPosition = { lat: 37.3130, lng: 138.7950 };
    let targetSpotForAddPhoto = null; // 「この場所で写真を追加」用の対象スポット
    const map = L.map('map', {
        attributionControl: false // ここで右下のクレジット文字を綺麗に消す
    }).setView([currentPosition.lat, currentPosition.lng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);

    // ==========================================
    // 2. NMEA解析ロジック & シリアル・位置情報切替
    // ==========================================
    const locModeRadios = document.querySelectorAll('input[name="loc-mode"]');
    const nmeaInputBox = document.getElementById('nmea-input-box');
    const nmeaTextInput = document.getElementById('nmea-text');
    const applyNmeaBtn = document.getElementById('apply-nmea-btn');
    const serialConnectBtn = document.getElementById('connect-serial-btn') || document.getElementById('serial-connect-btn');
    let serialReader = null;

    function parseNMEA(nmeaStr) {
        const parts = nmeaStr.trim().split(',');
        if (parts.length < 6) return null;

        const header = parts[0];
        let latRaw = "", latDir = "", lngRaw = "", lngDir = "";

        if (header.includes("GGA") || header.includes("GLL")) {
            latRaw = parts[2];
            latDir = parts[3];
            lngRaw = parts[4];
            lngDir = parts[5];
        } else if (header.includes("RMC")) {
            latRaw = parts[3];
            latDir = parts[4];
            lngRaw = parts[5];
            lngDir = parts[6];
        } else {
            return null;
        }

        if (!latRaw || !lngRaw) return null;

        const latDeg = parseFloat(latRaw.substring(0, 2));
        const latMin = parseFloat(latRaw.substring(2));
        let lat = latDeg + (latMin / 60);
        if (latDir === 'S') lat = -lat;

        const lngDeg = parseFloat(lngRaw.substring(0, 3));
        const lngMin = parseFloat(lngRaw.substring(3));
        let lng = lngDeg + (lngMin / 60);
        if (lngDir === 'W') lng = -lng;

        return { lat, lng };
    }

    locModeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'nmea') {
                if (nmeaInputBox) nmeaInputBox.classList.remove('hidden');
            } else {
                if (nmeaInputBox) nmeaInputBox.classList.add('hidden');
                fetchDeviceLocation();
            }
            updatePostLocationDisplay();
        });
    });

    function fetchDeviceLocation() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    currentPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    map.setView([currentPosition.lat, currentPosition.lng], 15);
                    updatePostLocationDisplay();
                },
                (err) => {
                    console.log('現在地取得失敗: ' + err.message);
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        }
    }

    if (applyNmeaBtn) {
        applyNmeaBtn.addEventListener('click', () => {
            const rawText = nmeaTextInput.value;
            const coords = parseNMEA(rawText);
            if (coords) {
                currentPosition = coords;
                map.setView([coords.lat, coords.lng], 16);
                updatePostLocationDisplay();
                alert(`NMEA適用完了: 緯度 ${coords.lat.toFixed(5)}, 経度 ${coords.lng.toFixed(5)}`);
            } else {
                alert('NMEAセンテンスの解析に失敗しました。');
            }
        });
    }

    if (serialConnectBtn) {
        serialConnectBtn.addEventListener('click', async () => {
            if (!('serial' in navigator)) {
                alert('お使いのブラウザはWeb Serial APIに対応していません。');
                return;
            }
            try {
                const port = await navigator.serial.requestPort();
                await port.open({ baudRate: 9600 });
                serialConnectBtn.textContent = "🟢 シリアル接続中";
                serialConnectBtn.style.backgroundColor = "#ff9500";

                const textDecoder = new TextDecoderStream();
                port.readable.pipeTo(textDecoder.writable);
                serialReader = textDecoder.readable.getReader();

                let buffer = "";
                while (true) {
                    const { value, done } = await serialReader.read();
                    if (done) break;
                    if (value) {
                        buffer += value;
                        let lines = buffer.split('\n');
                        buffer = lines.pop();
                        for (let line of lines) {
                            line = line.trim();
                            if (line.startsWith('$')) {
                                nmeaTextInput.value = line;
                                const coords = parseNMEA(line);
                                if (coords) {
                                    currentPosition = coords;
                                    updatePostLocationDisplay();
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('シリアル通信エラー:', err);
            }
        });
    }


    // ==========================================
    // 3. 初期データ & LocalStorage 保存
    // ==========================================
    const defaultSpots = [];

    let rawSpots = JSON.parse(localStorage.getItem('ojiya_photo_spots')) || defaultSpots;
    // 過去の初期ダミーデータ（spot_local_1, spot_local_2）が含まれていれば除外
    rawSpots = rawSpots.filter(s => s.id !== "spot_local_1" && s.id !== "spot_local_2");

    let spots = rawSpots.map(s => {
        if (!s.images && s.image) {
            s.images = [s.image];
            s.dates = [s.date || new Date().toISOString().split('T')[0]];
        }
        if (!s.images) {
            s.images = [];
            s.dates = [];
        }
        return s;
    });

    let likedSpotIds = JSON.parse(localStorage.getItem('ojiya_liked_spots')) || [];

    function saveSpotsToStorage() {
        try {
            localStorage.setItem('ojiya_photo_spots', JSON.stringify(spots));
        } catch (e) {
            console.error('LocalStorage保存エラー:', e);
            alert('写真データの保存容量を超えたため保存できませんでした。');
        }
    }

    function saveLikedSpotsToStorage() {
        try {
            localStorage.setItem('ojiya_liked_spots', JSON.stringify(likedSpotIds));
        } catch (e) {
            console.error('LocalStorage保存エラー:', e);
        }
    }


    // ==========================================
    // 4. マップ表示 (近接ピンの重なり防止・クラスタリング対応)
    // ==========================================
    const markers = {};

    const defaultPinImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 24 24' fill='%23007aff'%3E%3Cpath d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z'/%3E%3C/svg%3E";

    function createPhotoIcon(imageUrl) {
        return L.divIcon({
            className: 'custom-photo-pin',
            html: `<div class="pin-bubble"><div class="pin-card"><img src="${imageUrl || defaultPinImage}" alt="pin"></div></div>`,
            iconSize: [46, 56],
            iconAnchor: [23, 56]
        });
    }

    // 近接したピンをまとめ、拡大（ズームイン）時に個別の写真ピンに自動分離する設定
    const markerClusterGroup = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 30, // まとめる半径（小さめにしてズームですぐ分かれやすく）
        disableClusteringAtZoom: 16, // ズームレベル16以上（拡大時）はクラスタを解除して個別ピンを表示！
        spiderfyOnMaxZoom: true, // 同一地点ピンの展開
        zoomToBoundsOnClick: true,
        spiderfyDistanceMultiplier: 1.5,
        iconCreateFunction: function (cluster) {
            const count = cluster.getChildCount();
            const childMarkers = cluster.getAllChildMarkers();
            let photoUrl = defaultPinImage;
            if (childMarkers.length > 0 && childMarkers[0].options && childMarkers[0].options.spotPhoto) {
                photoUrl = childMarkers[0].options.spotPhoto;
            }
            return L.divIcon({
                className: 'custom-photo-pin custom-cluster-pin',
                html: `<div class="pin-bubble"><div class="pin-card cluster-card"><img src="${photoUrl}" alt="cluster"><span class="cluster-badge">${count}</span></div></div>`,
                iconSize: [46, 56],
                iconAnchor: [23, 56]
            });
        }
    });
    map.addLayer(markerClusterGroup);

    // 同一または極めて近い座標のスポットが重なって隠れるのを防ぐオフセット計算
    function getAdjustedLatLng(spot) {
        const sameLocSpots = spots.filter(s =>
            Math.abs(s.lat - spot.lat) < 0.00008 && Math.abs(s.lng - spot.lng) < 0.00008
        );

        if (sameLocSpots.length <= 1) {
            return [spot.lat, spot.lng];
        }

        const index = sameLocSpots.findIndex(s => s.id === spot.id);
        if (index === -1) return [spot.lat, spot.lng];

        // 円周状にわずかに分散配置（約8mずらす）
        const angle = (2 * Math.PI / sameLocSpots.length) * index;
        const radiusLat = 0.00008;
        const radiusLng = 0.00010;

        const adjustedLat = spot.lat + (radiusLat * Math.sin(angle));
        const adjustedLng = spot.lng + (radiusLng * Math.cos(angle));

        return [adjustedLat, adjustedLng];
    }

    function addSpotToMap(spot) {
        const latestImage = (spot.images && spot.images.length > 0)
            ? spot.images[spot.images.length - 1]
            : defaultPinImage;
        const customIcon = createPhotoIcon(latestImage);
        const [displayLat, displayLng] = getAdjustedLatLng(spot);
        const marker = L.marker([displayLat, displayLng], {
            icon: customIcon,
            spotPhoto: latestImage
        });

        marker.on('click', () => {
            openModal(spot);
        });

        markers[spot.id] = marker;
        markerClusterGroup.addLayer(marker);
    }

    function renderAllMarkers() {
        markerClusterGroup.clearLayers();
        Object.keys(markers).forEach(id => delete markers[id]);
        spots.forEach(spot => addSpotToMap(spot));
    }

    renderAllMarkers();


    // ==========================================
    // 5. タグ絞り込みフィルター機能
    // ==========================================
    let currentFilterTag = "すべて";

    function updateFilterBar() {
        const filterBar = document.getElementById('filter-bar');
        if (!filterBar) return;
        filterBar.innerHTML = '';

        const tagSet = new Set();
        spots.forEach(s => {
            if (s.tags) {
                const matches = s.tags.match(/#[^\s#]+/g);
                if (matches) matches.forEach(t => tagSet.add(t));
            }
        });

        const tagsList = ["すべて", ...Array.from(tagSet)];

        tagsList.forEach(tag => {
            const btn = document.createElement('button');
            btn.className = `filter-chip ${tag === currentFilterTag ? 'active' : ''}`;
            btn.textContent = tag;
            btn.onclick = () => filterByTag(tag);
            filterBar.appendChild(btn);
        });
    }

    function filterByTag(tag) {
        currentFilterTag = tag;
        updateFilterBar();

        markerClusterGroup.clearLayers();
        spots.forEach(spot => {
            if (tag === "すべて" || (spot.tags && spot.tags.includes(tag))) {
                const marker = markers[spot.id];
                if (marker) {
                    markerClusterGroup.addLayer(marker);
                }
            }
        });
    }

    updateFilterBar();


    // ==========================================
    // 6. 投稿フォームの位置情報表示
    // ==========================================
    const postForm = document.getElementById('post-form');

    function initPostLocationField() {
        if (!postForm) return;
        let locBox = document.getElementById('post-location-info');
        if (!locBox) {
            locBox = document.createElement('div');
            locBox.id = 'post-location-info';
            locBox.style.cssText = `
                background: #f0f4f8;
                padding: 10px;
                margin: 12px 0;
                border-radius: 6px;
                font-size: 13px;
                color: #333;
                border-left: 4px solid #007aff;
            `;
            const submitBtn = postForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                postForm.insertBefore(locBox, submitBtn);
            } else {
                postForm.appendChild(locBox);
            }
        }
        updatePostLocationDisplay();
    }

    function updatePostLocationDisplay() {
        const locBox = document.getElementById('post-location-info');
        if (locBox) {
            const getMode = () => {
                const radios = document.querySelectorAll('input[name="loc-mode"]');
                for (let r of radios) { if (r.checked) return r.value; }
                return 'device';
            };
            const mode = getMode();
            const modeLabel = mode === 'nmea' ? '🛰️ NMEA測位' : '📱 デバイス現在地';
            locBox.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                    <div>
                        <strong>📍 記録される位置 (${modeLabel})</strong><br>
                        緯度: ${currentPosition.lat.toFixed(6)} / 経度: ${currentPosition.lng.toFixed(6)}
                    </div>
                    <button type="button" id="refresh-gps-btn" style="background:#007aff; color:white; border:none; padding:5px 10px; border-radius:6px; font-size:12px; cursor:pointer; font-weight:600;">🔄 現在地を再取得</button>
                </div>
            `;
            document.getElementById('refresh-gps-btn')?.addEventListener('click', () => {
                const devRadio = document.querySelector('input[name="loc-mode"][value="device"]');
                if (devRadio) devRadio.checked = true;
                if (nmeaInputBox) nmeaInputBox.classList.add('hidden');
                fetchDeviceLocation();
            });
        }
    }

    initPostLocationField();


    // ==========================================
    // 7. モーダル ＆ ナビゲーション操作
    // ==========================================
    const searchModal = document.getElementById('search-modal');
    const createPostModal = document.getElementById('create-post-modal');
    const postModal = document.getElementById('post-modal');
    const rankingModal = document.getElementById('ranking-modal');

    function closeAllModals() {
        [searchModal, createPostModal, postModal, rankingModal].forEach(m => {
            if (m) m.classList.add('hidden');
        });
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
        document.getElementById('nav-map-btn')?.classList.add('active');
    }

    function bindClick(id, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    }

    bindClick('close-search-modal', closeAllModals);
    bindClick('close-create-modal', closeAllModals);
    bindClick('close-modal', closeAllModals);
    bindClick('close-ranking-modal', closeAllModals);
    bindClick('nav-map-btn', closeAllModals);

    bindClick('nav-search-btn', () => {
        closeAllModals();
        if (searchModal) searchModal.classList.remove('hidden');
        document.getElementById('nav-search-btn')?.classList.add('active');
        renderSearchResults('');
    });

    bindClick('nav-post-btn', () => {
        closeAllModals();
        targetSpotForAddPhoto = null; // 新規投稿モード
        const modalTitle = document.getElementById('create-modal-title');
        if (modalTitle) modalTitle.textContent = 'ディープスポットを投稿';

        const titleInput = document.getElementById('input-title');
        if (titleInput) {
            titleInput.value = '';
            titleInput.readOnly = false;
            titleInput.style.backgroundColor = '';
        }
        const captionInput = document.getElementById('input-caption');
        if (captionInput) captionInput.value = '';
        const tagsInput = document.getElementById('input-tags');
        if (tagsInput) tagsInput.value = '';

        const devRadio = document.querySelector('input[name="loc-mode"][value="device"]');
        if (devRadio) devRadio.checked = true;
        if (nmeaInputBox) nmeaInputBox.classList.add('hidden');

        fetchDeviceLocation();
        updatePostLocationDisplay();
        if (createPostModal) createPostModal.classList.remove('hidden');
        document.getElementById('nav-post-btn')?.classList.add('active');
    });

    bindClick('nav-ranking-btn', () => {
        closeAllModals();
        if (rankingModal) rankingModal.classList.remove('hidden');
        document.getElementById('nav-ranking-btn')?.classList.add('active');
        renderRankingList();
    });


    // ==========================================
    // 8. 検索 ＆ ランキング
    // ==========================================
    const searchInput = document.getElementById('search-input');
    const searchResultsList = document.getElementById('search-results-list');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderSearchResults(e.target.value.toLowerCase().trim());
        });
    }

    function renderSearchResults(query) {
        if (!searchResultsList) return;
        searchResultsList.innerHTML = '';
        const filtered = spots.filter(s => 
            s.title.toLowerCase().includes(query) || 
            (s.tags && s.tags.toLowerCase().includes(query))
        );

        if (filtered.length === 0) {
            searchResultsList.innerHTML = '<p style="font-size:13px; color:#8e8e93; text-align:center; padding:20px;">一致するスポットが見つかりません</p>';
            return;
        }

        filtered.forEach(spot => {
            const latestImg = spot.images[spot.images.length - 1];
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `
                <img src="${latestImg}" class="list-thumb" style="width:40px;height:40px;object-fit:cover;border-radius:4px;margin-right:10px;">
                <div class="list-info">
                    <span class="list-title" style="font-weight:bold;">${spot.title}</span><br>
                    <span class="list-subtitle" style="font-size:12px;color:#666;">写真 ${spot.images.length}枚 | ♥ ${spot.likes}</span>
                </div>
            `;
            item.onclick = () => {
                closeAllModals();
                map.setView([spot.lat, spot.lng], 16);
                openModal(spot);
            };
            searchResultsList.appendChild(item);
        });
    }

    function renderRankingList() {
        const rankingList = document.getElementById('ranking-list');
        if (!rankingList) return;
        rankingList.innerHTML = '';

        const sortedSpots = [...spots].sort((a, b) => b.likes - a.likes);

        sortedSpots.forEach((spot, index) => {
            const latestImg = spot.images[spot.images.length - 1];
            const item = document.createElement('div');
            item.className = 'list-item';
            let badge = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`;
            
            item.innerHTML = `
                <span style="font-weight:bold; width:24px; text-align:center;">${badge}</span>
                <img src="${latestImg}" class="list-thumb" style="width:40px;height:40px;object-fit:cover;border-radius:4px;margin:0 8px;">
                <div class="list-info">
                    <span class="list-title" style="font-weight:bold;">${spot.title}</span><br>
                    <span class="list-subtitle" style="font-size:12px;color:#666;">写真 ${spot.images.length}枚 | ♥ ${spot.likes}</span>
                </div>
            `;
            item.onclick = () => {
                closeAllModals();
                map.setView([spot.lat, spot.lng], 16);
                openModal(spot);
            };
            rankingList.appendChild(item);
        });
    }


    // ==========================================
    // 9. 詳細モーダル & 写真切り替えスライダー機能
    // ==========================================
    let activeSpot = null;
    let currentImageIndex = 0;

    function openModal(spot) {
        activeSpot = spot;
        currentImageIndex = (spot.images && spot.images.length > 0) ? spot.images.length - 1 : 0;

        const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='%238e8e93'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
        document.getElementById('modal-avatar').src = spot.avatar || defaultAvatar;
        document.getElementById('modal-username').textContent = spot.username || "ユーザー";
        document.getElementById('modal-title').textContent = spot.title;
        document.getElementById('like-count').textContent = spot.likes || 0;

        const captionEl = document.getElementById('modal-caption');
        if (captionEl) captionEl.textContent = spot.caption || "";

        const tagsEl = document.getElementById('modal-tags');
        if (tagsEl) tagsEl.textContent = spot.tags || "";

        // 閲覧モードを表示、編集モードを非表示
        modalViewMode?.classList.remove('hidden');
        modalEditMode?.classList.add('hidden');
        editSpotBtn?.classList.remove('hidden');
        deleteSpotBtn?.classList.remove('hidden');

        updateModalImageDisplay();

        const likeBtn = document.getElementById('like-btn');
        if (likeBtn) {
            if (likedSpotIds.includes(spot.id)) {
                likeBtn.classList.add('liked');
            } else {
                likeBtn.classList.remove('liked');
            }
        }

        // --- 「この場所で写真を撮る・追加する」ボタンの確実な生成とイベント登録 ---
        let spotActionBox = document.getElementById('spot-action-box');
        if (!spotActionBox) {
            spotActionBox = document.createElement('div');
            spotActionBox.id = 'spot-action-box';
            spotActionBox.style.cssText = `margin: 15px 0; text-align: center;`;
            
            // HTMLを先に挿入
            spotActionBox.innerHTML = `
                <button id="shoot-here-btn" style="
                    background-color: #007aff;
                    color: white;
                    border: none;
                    padding: 10px 16px;
                    border-radius: 20px;
                    font-weight: bold;
                    font-size: 14px;
                    cursor: pointer;
                    box-shadow: 0 2px 6px rgba(0,122,255,0.3);
                    width: 100%;
                ">📍 この場所で写真を撮る・追加する</button>
            `;
            const modalImageContainer = document.getElementById('modal-image')?.parentNode;
            if (modalImageContainer) {
                modalImageContainer.parentNode.insertBefore(spotActionBox, modalImageContainer.nextSibling);
            }
        }

        // 毎回確実にクリックイベントを割り当て直す
        const shootHereBtn = document.getElementById('shoot-here-btn');
        if (shootHereBtn) {
            shootHereBtn.onclick = () => {
                targetSpotForAddPhoto = spot; // 既存スポット追加モード
                if (postModal) postModal.classList.add('hidden');
                if (createPostModal) createPostModal.classList.remove('hidden');
                
                document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
                document.getElementById('nav-post-btn')?.classList.add('active');

                const modalTitle = document.getElementById('create-modal-title');
                if (modalTitle) modalTitle.textContent = `「${spot.title}」に写真を追加`;

                // 座標をこのスポットのものに固定
                currentPosition = { lat: spot.lat, lng: spot.lng };
                updatePostLocationDisplay();

                // タイトルを引き継ぎ、編集不可にして明示
                const titleInput = document.getElementById('input-title');
                if (titleInput) {
                    titleInput.value = spot.title;
                    titleInput.readOnly = true;
                    titleInput.style.backgroundColor = '#f2f2f7';
                }
                const captionInput = document.getElementById('input-caption');
                if (captionInput) captionInput.value = '';
                const tagsInput = document.getElementById('input-tags');
                if (tagsInput) tagsInput.value = spot.tags || '';
            };
        }

        renderComments(spot.comments || []);
        if (postModal) postModal.classList.remove('hidden');
    }

    function updateModalImageDisplay() {
        if (!activeSpot) return;

        const modalImage = document.getElementById('modal-image');
        const modalDate = document.getElementById('modal-date');
        
        let sliderNav = document.getElementById('photo-slider-nav');
        if (!sliderNav) {
            sliderNav = document.createElement('div');
            sliderNav.id = 'photo-slider-nav';
            sliderNav.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin: 8px 0;`;
            modalImage.parentNode.insertBefore(sliderNav, modalImage.nextSibling);
        }

        if (!activeSpot.images || activeSpot.images.length === 0) {
            modalImage.src = defaultPinImage;
            modalDate.textContent = '写真なし';
            sliderNav.innerHTML = '';
            return;
        }

        modalImage.src = activeSpot.images[currentImageIndex];
        const dateStr = (activeSpot.dates && activeSpot.dates[currentImageIndex]) ? activeSpot.dates[currentImageIndex] : new Date().toISOString().split('T')[0];
        modalDate.textContent = `撮影日: ${dateStr} (${currentImageIndex + 1} / ${activeSpot.images.length}枚目)`;

        if (activeSpot.images.length > 1) {
            sliderNav.innerHTML = `
                <button id="prev-photo-btn" style="background:#ddd; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-weight:bold;">◀ 前の写真</button>
                <span style="font-size:12px; color:#666;">移り変わりを表示中</span>
                <button id="next-photo-btn" style="background:#ddd; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-weight:bold;">次の写真 ▶</button>
            `;

            document.getElementById('prev-photo-btn').onclick = () => {
                if (currentImageIndex > 0) {
                    currentImageIndex--;
                    updateModalImageDisplay();
                }
            };
            document.getElementById('next-photo-btn').onclick = () => {
                if (currentImageIndex < activeSpot.images.length - 1) {
                    currentImageIndex++;
                    updateModalImageDisplay();
                }
            };
        } else {
            sliderNav.innerHTML = `<span style="font-size:12px; color:#888; width:100%; text-align:center; display:block;">この場所の写真（全1枚）</span>`;
        }
    }

    function renderComments(comments) {
        const list = document.getElementById('comments-list');
        if (!list) return;
        list.innerHTML = '';
        comments.forEach(c => {
            const div = document.createElement('div');
            div.className = 'comment-item';
            div.innerHTML = `<strong>ゲスト:</strong> ${c.text}`;
            list.appendChild(div);
        });
    }

    bindClick('like-btn', () => {
        if (!activeSpot) return;
        const index = likedSpotIds.indexOf(activeSpot.id);
        if (index === -1) {
            likedSpotIds.push(activeSpot.id);
            activeSpot.likes = (activeSpot.likes || 0) + 1;
        } else {
            likedSpotIds.splice(index, 1);
            activeSpot.likes = Math.max(0, (activeSpot.likes || 0) - 1);
        }
        saveLikedSpotsToStorage();
        saveSpotsToStorage();
        openModal(activeSpot);
    });

    // コメント投稿
    const commentForm = document.getElementById('comment-form');
    const commentInput = document.getElementById('comment-input');
    if (commentForm) {
        commentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!activeSpot || !commentInput) return;
            const text = commentInput.value.trim();
            if (!text) return;
            if (!activeSpot.comments) activeSpot.comments = [];
            activeSpot.comments.push({
                text: text,
                date: new Date().toISOString().split('T')[0]
            });
            saveSpotsToStorage();
            renderComments(activeSpot.comments);
            commentInput.value = '';
        });
    }

    // スポット編集 & 削除
    const editSpotBtn = document.getElementById('edit-spot-btn');
    const deleteSpotBtn = document.getElementById('delete-spot-btn');
    const modalViewMode = document.getElementById('modal-view-mode');
    const modalEditMode = document.getElementById('modal-edit-mode');
    const editTitleInput = document.getElementById('edit-title-input');
    const editCaptionInput = document.getElementById('edit-caption-input');
    const editTagsInput = document.getElementById('edit-tags-input');
    const saveEditBtn = document.getElementById('save-edit-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');

    if (editSpotBtn) {
        editSpotBtn.addEventListener('click', () => {
            if (!activeSpot) return;
            modalViewMode?.classList.add('hidden');
            modalEditMode?.classList.remove('hidden');
            if (editTitleInput) editTitleInput.value = activeSpot.title || "";
            if (editCaptionInput) editCaptionInput.value = activeSpot.caption || "";
            if (editTagsInput) editTagsInput.value = activeSpot.tags || "";
        });
    }

    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', () => {
            modalEditMode?.classList.add('hidden');
            modalViewMode?.classList.remove('hidden');
        });
    }

    if (saveEditBtn) {
        saveEditBtn.addEventListener('click', () => {
            if (!activeSpot) return;
            const newTitle = editTitleInput?.value.trim();
            if (!newTitle) {
                alert('タイトルを入力してください。');
                return;
            }
            activeSpot.title = newTitle;
            activeSpot.caption = editCaptionInput?.value.trim() || "";
            activeSpot.tags = editTagsInput?.value.trim() || "";

            saveSpotsToStorage();
            renderAllMarkers();
            updateFilterBar();

            modalEditMode?.classList.add('hidden');
            modalViewMode?.classList.remove('hidden');
            openModal(activeSpot);
        });
    }

    if (deleteSpotBtn) {
        deleteSpotBtn.addEventListener('click', () => {
            if (!activeSpot) return;
            if (confirm(`「${activeSpot.title}」を削除してもよろしいですか？`)) {
                spots = spots.filter(s => s.id !== activeSpot.id);
                saveSpotsToStorage();
                renderAllMarkers();
                updateFilterBar();
                closeAllModals();
            }
        });
    }


    // ==========================================
    // 10. 新規投稿 & 同じ場所への写真追加処理
    // ==========================================
    const photoInput = document.getElementById('photo-input');
    const imagePreview = document.getElementById('image-preview');
    const uploadArea = document.querySelector('.photo-upload-area');
    const uploadHint = document.getElementById('upload-hint');
    let uploadedImageBase64 = "";

    function compressImage(file, maxWidth = 1000, maxHeight = 1000, quality = 0.75) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxWidth) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width = Math.round((width * maxHeight) / height);
                            height = maxHeight;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    resolve(dataUrl);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    if (uploadArea && photoInput) {
        uploadArea.addEventListener('click', () => {
            photoInput.click();
        });
    }

    if (photoInput) {
        photoInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    uploadedImageBase64 = await compressImage(file);
                    if (imagePreview) {
                        imagePreview.src = uploadedImageBase64;
                        imagePreview.classList.remove('hidden');
                    }
                    if (uploadHint) {
                        uploadHint.classList.add('hidden');
                    }
                } catch (err) {
                    console.error('画像読み込み・圧縮エラー:', err);
                    alert('画像の読み込みに失敗しました。');
                }
            }
        });
    }

    if (postForm) {
        postForm.addEventListener('submit', (e) => {
            e.preventDefault();

            if (!uploadedImageBase64) {
                alert('写真をアップロードしてください。');
                return;
            }

            const titleInput = document.getElementById('input-title');
            const title = titleInput ? titleInput.value.trim() : "無題のスポット";
            const captionInput = document.getElementById('input-caption');
            const caption = captionInput ? captionInput.value.trim() : "";
            const tagsInput = document.getElementById('input-tags');
            const tags = tagsInput ? tagsInput.value.trim() : "";
            const today = new Date().toISOString().split('T')[0];
            const newImage = uploadedImageBase64;

            if (targetSpotForAddPhoto) {
                // 明示的に「この場所で写真を追加」から来た場合のみ同一スポットに追加
                const existingSpot = spots.find(s => s.id === targetSpotForAddPhoto.id);
                if (existingSpot) {
                    if (!existingSpot.images) existingSpot.images = [];
                    if (!existingSpot.dates) existingSpot.dates = [];
                    existingSpot.images.push(newImage);
                    existingSpot.dates.push(today);
                    if (caption) existingSpot.caption = caption;
                    if (tags) existingSpot.tags = tags;
                }
            } else {
                // 通常の新規投稿：同名タイトルでも常に独立した新規スポットとして作成！
                const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='%238e8e93'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
                const newSpot = {
                    id: `spot_local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    title: title,
                    caption: caption,
                    lat: currentPosition.lat,
                    lng: currentPosition.lng,
                    username: "ゲスト",
                    avatar: defaultAvatar,
                    images: [newImage],
                    dates: [today],
                    tags: tags || "#小千谷",
                    likes: 0,
                    comments: []
                };
                spots.unshift(newSpot);
            }

            saveSpotsToStorage();
            renderAllMarkers();
            updateFilterBar();

            postForm.reset();
            if (imagePreview) {
                imagePreview.src = '';
                imagePreview.classList.add('hidden');
            }
            if (uploadHint) {
                uploadHint.classList.remove('hidden');
            }
            uploadedImageBase64 = "";
            photoInput.value = "";
            targetSpotForAddPhoto = null;

            closeAllModals();
            map.setView([currentPosition.lat, currentPosition.lng], 16);
            alert('スポットを投稿しました！');
        });
    }

});
