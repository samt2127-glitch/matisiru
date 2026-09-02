import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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
    // 1. 地図の初期化 (Leaflet + CARTO)
    // ==========================================
    let currentPosition = { lat: 37.3130, lng: 138.7950 };
    const map = L.map('map').setView([currentPosition.lat, currentPosition.lng], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
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
                }
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
        localStorage.setItem('ojiya_photo_spots', JSON.stringify(spots));
    }

    function saveLikedSpotsToStorage() {
        localStorage.setItem('ojiya_liked_spots', JSON.stringify(likedSpotIds));
    }


    // ==========================================
    // 4. マップ表示
    // ==========================================
    const markers = {};

    function createPhotoIcon(imageUrl) {
        return L.divIcon({
            className: 'custom-photo-pin',
            html: `<div class="pin-bubble"><div class="pin-card"><img src="${imageUrl}" alt="pin"></div></div>`,
            iconSize: [46, 56],
            iconAnchor: [23, 56]
        });
    }

    function addSpotToMap(spot) {
        const latestImage = spot.images[spot.images.length - 1];
        const customIcon = createPhotoIcon(latestImage);
        const marker = L.marker([spot.lat, spot.lng], { icon: customIcon }).addTo(map);

        marker.on('click', () => {
            openModal(spot);
        });

        markers[spot.id] = marker;
    }

    function renderAllMarkers() {
        Object.keys(markers).forEach(id => map.removeLayer(markers[id]));
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

        spots.forEach(spot => {
            const marker = markers[spot.id];
            if (!marker) return;

            if (tag === "すべて" || (spot.tags && spot.tags.includes(tag))) {
                if (!map.hasLayer(marker)) map.addLayer(marker);
            } else {
                if (map.hasLayer(marker)) map.removeLayer(marker);
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
            const modeLabel = getMode() === 'nmea' ? '🛰️ NMEA測位' : '📱 デバイス測位';
            locBox.innerHTML = `
                <strong>📍 記録される位置情報 (${modeLabel})</strong><br>
                緯度: ${currentPosition.lat.toFixed(6)} / 経度: ${currentPosition.lng.toFixed(6)}
            `;
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
        currentImageIndex = spot.images.length - 1;

        const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='%238e8e93'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
        document.getElementById('modal-avatar').src = spot.avatar || defaultAvatar;
        document.getElementById('modal-username').textContent = spot.username || "ユーザー";
        document.getElementById('modal-title').textContent = spot.title;
        document.getElementById('like-count').textContent = spot.likes || 0;

        const captionEl = document.getElementById('modal-caption');
        if (captionEl) captionEl.textContent = spot.caption || "";

        const tagsEl = document.getElementById('modal-tags');
        if (tagsEl) tagsEl.textContent = spot.tags || "";

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
                // 詳細モーダルだけを隠し、投稿モーダルを表示
                if (postModal) postModal.classList.add('hidden');
                if (createPostModal) createPostModal.classList.remove('hidden');
                
                document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
                document.getElementById('nav-post-btn')?.classList.add('active');

                // 座標をこのスポットのものに固定
                currentPosition = { lat: spot.lat, lng: spot.lng };
                updatePostLocationDisplay();

                // タイトルを自動で引き継ぐ
                const titleInput = document.getElementById('input-title');
                if (titleInput) {
                    titleInput.value = spot.title;
                }
            };
        }

        renderComments(spot.comments || []);
        if (postModal) postModal.classList.remove('hidden');
    }

    function updateModalImageDisplay() {
        if (!activeSpot) return;

        const modalImage = document.getElementById('modal-image');
        const modalDate = document.getElementById('modal-date');
        
        modalImage.src = activeSpot.images[currentImageIndex];
        const dateStr = (activeSpot.dates && activeSpot.dates[currentImageIndex]) ? activeSpot.dates[currentImageIndex] : "2026-08-01";
        modalDate.textContent = `撮影日: ${dateStr} (${currentImageIndex + 1} / ${activeSpot.images.length}枚目)`;

        let sliderNav = document.getElementById('photo-slider-nav');
        if (!sliderNav) {
            sliderNav = document.createElement('div');
            sliderNav.id = 'photo-slider-nav';
            sliderNav.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin: 8px 0;`;
            modalImage.parentNode.insertBefore(sliderNav, modalImage.nextSibling);
        }

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
            activeSpot.likes++;
        } else {
            likedSpotIds.splice(index, 1);
            activeSpot.likes--;
        }
        saveLikedSpotsToStorage();
        saveSpotsToStorage();
        openModal(activeSpot);
    });


    // ==========================================
    // 10. 新規投稿 & 同じ場所への写真追加処理
    // ==========================================
    const photoInput = document.getElementById('photo-input');
    const imagePreview = document.getElementById('image-preview');
    let uploadedImageBase64 = "";

    if (photoInput) {
        photoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function (event) {
                    uploadedImageBase64 = event.target.result;
                    if (imagePreview) {
                        imagePreview.src = uploadedImageBase64;
                        imagePreview.classList.remove('hidden');
                    }
                };
                reader.readAsDataURL(file);
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

            let existingSpot = spots.find(s => s.title === title);

            if (existingSpot) {
                if (!existingSpot.images) existingSpot.images = [];
                if (!existingSpot.dates) existingSpot.dates = [];
                existingSpot.images.push(newImage);
                existingSpot.dates.push(today);
                if (caption) existingSpot.caption = caption;
                if (tags) existingSpot.tags = tags;
            } else {
                const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='%238e8e93'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
                const newSpot = {
                    id: `spot_local_${Date.now()}`,
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
            if (imagePreview) imagePreview.classList.add('hidden');
            uploadedImageBase64 = "";

            closeAllModals();
            map.setView([currentPosition.lat, currentPosition.lng], 16);
        });
    }

});
