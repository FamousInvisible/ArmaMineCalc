import { importBallisticTable, calculateShotParameters, generateTrajectoryPoints } from './ballistics.js';
document.addEventListener('DOMContentLoaded', () => {
    // Обработчик импорта - ТОЛЬКО ПОСЛЕ ЗАГРУЗКИ DOM
    const importBtn = document.getElementById('importBallisticTable');
    if (importBtn) {
        importBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
                if (e.target.files.length > 0) {
                    importBallisticTable(e.target.files[0]);
                }
            };
            input.click();
        });
    } else {
        console.error('Кнопка импорта не найдена! Проверьте ID элемента');
    }
})
// Глобальные переменные
let map = null;
let currentMapImageUrl = null;
let vectorSource = new ol.source.Vector();
let vectorLayer = new ol.layer.Vector({
    source: vectorSource,
    style: function (feature) {
        const type = feature.get('type');
        if (type === 'mortar') {
            return new ol.style.Style({
                image: new ol.style.Icon({
                    src: 'icons/mortar.png',
                    scale: 0.5,
                    anchor: [0.5, 1]
                })
            });
        } else if (type === 'target') {
            return new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 6,
                    fill: new ol.style.Fill({ color: '#ff0000' }),
                    stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
                })
            });
        } else if (type === 'line') {
            return new ol.style.Style({
                stroke: new ol.style.Stroke({ color: 'rgba(0, 0, 255, 0.7)', width: 3 })
            });
        } else if (type === 'calibration') {
            return new ol.style.Style({
                stroke: new ol.style.Stroke({
                    color: '#ffcc00',
                    width: 4,
                    lineDash: [5, 5]
                }),
                image: new ol.style.Circle({
                    radius: 6,
                    fill: new ol.style.Fill({ color: '#ffcc00' })
                })
            });
        }
    }
});

let mortarPoint = null;
let mortarNameOverlay = null;
let targets = [];
let overlays = [];
let currentState = 'select-mortar';
let modifyInteraction = null;
let selectedFeature = null;
let contextMenu = document.getElementById('context-menu');

// Переменные для калибровки
let calibrationPoints = [];
let calibrationLineFeature = null;
let calibrationLayer = null;
let metersPerPixel = 0;
let calibrationActive = false;

// Функция инициализации карты
function initMap(widthPixels, heightPixels, mapUrl) {
    // Показать индикатор загрузки
    document.getElementById('loading-overlay').classList.remove('hidden');

    // Освобождаем предыдущий URL изображения
    if (currentMapImageUrl) {
        URL.revokeObjectURL(currentMapImageUrl);
    }
    currentMapImageUrl = mapUrl;

    // Создаем кастомную проекцию (в пикселях)
    const projection = new ol.proj.Projection({
        code: 'ballistic-projection',
        units: 'pixels',
        extent: [0, 0, widthPixels, heightPixels]
    });

    // Создаем источник изображения
    const imageSource = new ol.source.ImageStatic({
        url: mapUrl,
        projection: projection,
        imageExtent: [0, 0, widthPixels, heightPixels],
        interpolate: true
    });

    // Обработчики событий
    imageSource.on('imageloadend', () => {
        document.getElementById('loading-overlay').classList.add('hidden');
    });

    imageSource.on('imageloaderror', () => {
        document.getElementById('loading-overlay').classList.add('hidden');
        alert('Ошибка загрузки изображения');
    });

    // Создаем слой изображения
    const imageLayer = new ol.layer.Image({
        source: imageSource
    });

    // Удаляем старую карту если существует
    if (map) {
        map.setTarget(null);
        map = null;
    }

    // Очищаем все измерения при смене карты
    clearAllMeasurements();

    // Создаем новую карту
    map = new ol.Map({
        target: 'map-container',
        layers: [imageLayer, vectorLayer],
        view: new ol.View({
            projection: projection,
            center: [widthPixels / 2, heightPixels / 2],
            zoom: 4,
            minZoom: 0.5,
            maxZoom: 12
        })
    });

    // Добавляем возможность перетаскивания точек
    modifyInteraction = new ol.interaction.Modify({
        source: vectorSource,
        condition: ol.events.condition.primaryAction,
        style: null
    });

    modifyInteraction.on('modifystart', (event) => {
        selectedFeature = event.features.item(0);
    });

    modifyInteraction.on('modifyend', (event) => {
        updatePointOverlays();
    });

    map.addInteraction(modifyInteraction);

    // Обновляем размер карты после отрисовки
    setTimeout(() => {
        if (map) {
            map.updateSize();

            // Показываем элементы интерфейса
            document.getElementById('measurements').classList.remove('hidden');
            document.getElementById('status-bar').classList.remove('hidden');
            document.getElementById('instructions').classList.add('hidden');

            // Запускаем процесс калибровки
            startCalibration();
        }
    }, 100);
}

// Запуск процесса калибровки
function startCalibration() {
    // Создаем временный слой для линии калибровки
    const calibrationSource = new ol.source.Vector();
    calibrationLayer = new ol.layer.Vector({
        source: calibrationSource,
        style: function (feature) {
            return new ol.style.Style({
                stroke: new ol.style.Stroke({
                    color: '#ffcc00',
                    width: 4,
                    lineDash: [5, 5]
                }),
                image: new ol.style.Circle({
                    radius: 6,
                    fill: new ol.style.Fill({ color: '#ffcc00' })
                })
            });
        }
    });

    map.addLayer(calibrationLayer);

    // Показываем панель калибровки
    document.getElementById('calibration-panel').classList.remove('hidden');

    // Устанавливаем статус калибровки
    calibrationActive = true;
    document.getElementById('mode-indicator').textContent = "Калибровка: укажите 2 точки";

    // Сбрасываем состояние калибровки
    calibrationPoints = [];
    document.getElementById('calibration-length').textContent = '0';

    // Добавляем обработчики событий
    const clickHandler = map.on('click', (event) => {
        if (!calibrationActive) return;

        if (calibrationPoints.length < 2) {
            // Добавляем точку
            calibrationPoints.push(event.coordinate);

            // Добавляем точку на карту
            const pointFeature = new ol.Feature({
                geometry: new ol.geom.Point(event.coordinate),
                type: 'calibration'
            });
            calibrationLayer.getSource().addFeature(pointFeature);

            // Если есть две точки, рисуем линию
            if (calibrationPoints.length === 2) {
                const line = new ol.geom.LineString(calibrationPoints);
                calibrationLineFeature = new ol.Feature({
                    geometry: line,
                    type: 'calibration'
                });
                calibrationLayer.getSource().addFeature(calibrationLineFeature);

                // Обновляем отображение длины
                const length = line.getLength();
                document.getElementById('calibration-length').textContent = length.toFixed(1);
            }
        }
    });

    // Обработчик для кнопки перерисовки
    document.getElementById('redo-calibration').addEventListener('click', () => {
        resetCalibration();
    });

    // Обработчик для кнопки сохранения
    document.getElementById('save-calibration').addEventListener('click', () => {
        const distanceInput = parseFloat(document.getElementById('calibration-distance').value);

        if (calibrationPoints.length === 2 && !isNaN(distanceInput)) {
            // Рассчитываем масштаб
            const line = new ol.geom.LineString(calibrationPoints);
            const lengthPixels = line.getLength();
            metersPerPixel = distanceInput / lengthPixels;

            // Скрываем панель калибровки
            document.getElementById('calibration-panel').classList.add('hidden');

            // Удаляем временный слой
            map.removeLayer(calibrationLayer);
            calibrationLayer = null;
            calibrationActive = false;

            // Удаляем обработчики
            ol.Observable.unByKey(clickHandler);

            // Активируем основной инструментарий
            initMeasureTool();
        } else {
            alert('Пожалуйста, установите две точки и введите расстояние');
        }
    });

    // Обработчик для кнопки отмены
    document.getElementById('cancel-calibration').addEventListener('click', () => {
        // Скрываем панель калибровки
        document.getElementById('calibration-panel').classList.add('hidden');

        // Удаляем временный слой
        if (calibrationLayer) {
            map.removeLayer(calibrationLayer);
        }
        // Удаляем обработчики
        ol.Observable.unByKey(clickHandler);

        // Сбрасываем состояние
        calibrationActive = false;
        calibrationPoints = [];
    });
}

// Сброс калибровки
function resetCalibration() {
    if (calibrationLayer) {
        calibrationLayer.getSource().clear();
    }
    calibrationPoints = [];
    document.getElementById('calibration-length').textContent = '0';
}

// Очистка всех измерений
function clearAllMeasurements() {
    // Очищаем векторный слой
    vectorSource.clear();

    // Удаляем все оверлеи
    if (map) {
        overlays.forEach(overlay => map.removeOverlay(overlay));
    }
    overlays = [];

    // Очищаем список измерений
    targets = [];
    mortarPoint = null;
    mortarNameOverlay = null;
    currentState = 'select-mortar';
    updateMeasurementsList();

    // Обновляем статус
    document.getElementById('mode-indicator').textContent = "Укажите миномет";
}

// Обновление подписей точек
function updatePointOverlays() {
    // Обновляем подпись миномета
    if (mortarPoint && mortarNameOverlay) {
        const mortarCoord = mortarPoint.getGeometry().getCoordinates();
        mortarNameOverlay.setPosition(mortarCoord);
    }

    // Обновляем подписи целей
    targets.forEach(target => {
        if (target.point && target.nameOverlay) {
            const targetCoord = target.point.getGeometry().getCoordinates();
            target.nameOverlay.setPosition(targetCoord);
        }

        // Обновляем линию и расстояние
        if (mortarPoint && target.point && target.line && target.overlay) {
            const mortarCoord = mortarPoint.getGeometry().getCoordinates();
            const targetCoord = target.point.getGeometry().getCoordinates();

            // Обновляем линию
            target.line.getGeometry().setCoordinates([mortarCoord, targetCoord]);

            // Обновляем расстояние (с учетом калибровки)
            const pixelDistance = target.line.getGeometry().getLength();
            target.distance = Math.round(pixelDistance * (metersPerPixel || 1));

            // Обновляем оверлей расстояния
            const midPoint = getMidPoint(mortarCoord, targetCoord);
            target.overlay.setPosition(midPoint);
            target.overlay.getElement().textContent = `${target.distance} м`;
        }
    });

    // Обновляем список измерений
    updateMeasurementsList();
}

// Обновление списка измерений
function updateMeasurementsList() {
    const listElement = document.getElementById('measurements-list');
    listElement.innerHTML = '';

    if (targets.length === 0) {
        listElement.innerHTML = '<div class="text-muted">Нет целей</div>';
        return;
    }

    targets.forEach((target, index) => {
        const item = document.createElement('div');
        item.className = 'measurement-item';
        item.innerHTML = `
            <div>
                <span class="target-name" data-index="${index}">${target.name || `Цель ${index + 1}`}</span>: 
                ${target.distance} м
                <span class="delete-btn" data-index="${index}">[удалить]</span>
            </div>
        `;
        listElement.appendChild(item);
    });

    // Добавляем обработчики для кнопок удаления
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const index = parseInt(this.getAttribute('data-index'));
            deleteTarget(index);
        });
    });

    // Добавляем обработчики для редактирования имени
    document.querySelectorAll('.target-name').forEach(nameEl => {
        nameEl.addEventListener('click', function () {
            const index = parseInt(this.getAttribute('data-index'));
            editTargetName(index, this);
        });
    });
}

// Редактирование имени цели
function editTargetName(index, element) {
    const target = targets[index];
    const input = document.createElement('input');
    input.type = 'text';
    input.value = target.name || `Цель ${index + 1}`;
    input.className = 'name-edit-input';

    element.innerHTML = '';
    element.appendChild(input);
    input.focus();

    const saveName = () => {
        target.name = input.value;

        // Обновляем подпись на карте
        if (target.nameOverlay) {
            target.nameOverlay.getElement().textContent = target.name;
        }

        updateMeasurementsList();
    };

    input.addEventListener('blur', saveName);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveName();
    });
}

// Удаление конкретного измерения
function deleteTarget(index) {
    if (index >= 0 && index < targets.length) {
        const target = targets[index];

        // Удаляем оверлеи
        map.removeOverlay(target.overlay);
        map.removeOverlay(target.nameOverlay);

        // Удаляем фичи
        vectorSource.removeFeature(target.line);
        vectorSource.removeFeature(target.point);

        // Удаляем из массива
        targets.splice(index, 1);

        // Обновляем список
        updateMeasurementsList();
    }
}

// Инициализация инструмента измерения
function initMeasureTool() {
    // Удаляем старые обработчики
    map.getInteractions().forEach(interaction => {
        if (interaction instanceof ol.interaction.Draw) {
            map.removeInteraction(interaction);
        }
    });

    // Обработчик клика на карту
    map.on('click', (event) => {
        if (calibrationActive) return;

        if (currentState === 'select-mortar') {
            // Создаем точку миномета
            mortarPoint = new ol.Feature({
                geometry: new ol.geom.Point(event.coordinate),
                type: 'mortar'
            });
            vectorSource.addFeature(mortarPoint);

            // Создаем оверлей для подписи миномета
            const mortarOverlayElement = document.createElement('div');
            mortarOverlayElement.className = 'name-overlay';
            mortarOverlayElement.textContent = 'Миномет';

            mortarNameOverlay = new ol.Overlay({
                position: event.coordinate,
                element: mortarOverlayElement,
                positioning: 'center-center',
                offset: [0, -30]
            });

            map.addOverlay(mortarNameOverlay);
            overlays.push(mortarNameOverlay);

            // Переходим к выбору целей
            currentState = 'select-target';
            document.getElementById('mode-indicator').textContent = "Укажите цель";

        } else if (currentState === 'select-target' && mortarPoint) {
            // Создаем точку цели
            const targetPoint = new ol.Feature({
                geometry: new ol.geom.Point(event.coordinate),
                type: 'target'
            });
            vectorSource.addFeature(targetPoint);

            // Создаем линию от миномета к цели
            const mortarCoord = mortarPoint.getGeometry().getCoordinates();
            const targetLine = new ol.Feature({
                geometry: new ol.geom.LineString([mortarCoord, event.coordinate]),
                type: 'line'
            });
            vectorSource.addFeature(targetLine);

            // Вычисляем расстояние (с учетом калибровки)
            const pixelDistance = targetLine.getGeometry().getLength();
            const distance = Math.round(pixelDistance * (metersPerPixel || 1));

            // Создаем оверлей для отображения расстояния над линией
            const midPoint = getMidPoint(mortarCoord, event.coordinate);

            const overlayElement = document.createElement('div');
            overlayElement.className = 'distance-overlay';
            overlayElement.textContent = `${distance} м`;

            const overlay = new ol.Overlay({
                position: midPoint,
                element: overlayElement,
                positioning: 'center-center'
            });

            map.addOverlay(overlay);
            overlays.push(overlay);

            // Создаем оверлей для подписи цели
            const nameOverlayElement = document.createElement('div');
            nameOverlayElement.className = 'name-overlay';
            nameOverlayElement.textContent = `Цель ${targets.length + 1}`;

            const nameOverlay = new ol.Overlay({
                position: event.coordinate,
                element: nameOverlayElement,
                positioning: 'center-center',
                offset: [0, -20]
            });

            map.addOverlay(nameOverlay);
            overlays.push(nameOverlay);

            // Сохраняем цель
            targets.push({
                point: targetPoint,
                line: targetLine,
                overlay: overlay,
                nameOverlay: nameOverlay,
                distance: distance,
                name: `Цель ${targets.length + 1}`
            });

            // Обновляем список измерений
            updateMeasurementsList();
        }
    });

    // Обработка клавиатуры
    document.addEventListener('keydown', handleKeyPress);

    // Обработка правой кнопки мыши
    map.on('contextmenu', (event) => {
        event.preventDefault();

        // Определяем, по какой фиче кликнули
        const pixel = map.getEventPixel(event.originalEvent);
        const feature = map.forEachFeatureAtPixel(pixel, feature => feature);

        if (feature) {
            selectedFeature = feature;
            showContextMenu(event.originalEvent.clientX, event.originalEvent.clientY);
        }
    });
}

// Показ контекстного меню
function showContextMenu(x, y) {
    contextMenu.style.display = 'block';
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
}

// Скрытие контекстного меню
function hideContextMenu() {
    contextMenu.style.display = 'none';
}

// Обработка контекстного меню
document.getElementById('delete-point').addEventListener('click', () => {
    if (selectedFeature) {
        const type = selectedFeature.get('type');

        if (type === 'mortar') {
            clearAllMeasurements();
        } else if (type === 'target') {
            const targetIndex = targets.findIndex(t => t.point === selectedFeature);
            if (targetIndex !== -1) {
                deleteTarget(targetIndex);
            }
        }
    }
    hideContextMenu();
});

// Получение средней точки линии
function getMidPoint(coord1, coord2) {
    return [
        (coord1[0] + coord2[0]) / 2,
        (coord1[1] + coord2[1]) / 2
    ];
}

// Обработка нажатий клавиш
function handleKeyPress(event) {
    // ESC - отмена/очистка
    if (event.key === 'Escape') {
        if (calibrationActive) {
            // Отмена калибровки
            document.getElementById('calibration-panel').classList.add('hidden');
            if (calibrationLayer) {
                map.removeLayer(calibrationLayer);
            }
            calibrationActive = false;
            return;
        }

        if (currentState === 'select-target' && targets.length > 0) {
            deleteTarget(targets.length - 1);
        } else if (currentState === 'select-target') {
            vectorSource.removeFeature(mortarPoint);
            map.removeOverlay(mortarNameOverlay);
            mortarPoint = null;
            mortarNameOverlay = null;
            currentState = 'select-mortar';
            document.getElementById('mode-indicator').textContent = "Укажите миномет";
        }
    }
}

// Обработчик импорта карты
document.getElementById('apply-map-btn').addEventListener('click', function () {
    const fileInput = document.getElementById('map-file');
    const colsInput = document.getElementById('cols');
    const rowsInput = document.getElementById('rows');

    if (!fileInput.files.length) {
        alert('Выберите файл карты!');
        return;
    }

    // Получаем значения как числа
    const cols = parseFloat(colsInput.value);
    const rows = parseFloat(rowsInput.value);

    if (isNaN(cols) || cols <= 0 || isNaN(rows) || rows <= 0) {
        alert('Проверьте введенные значения! Все поля должны содержать положительные числа.');
        return;
    }

    const file = fileInput.files[0];

    // Проверка для Firefox
    if (file.size === 0) {
        alert('Ошибка: Файл имеет нулевой размер. Попробуйте другой файл.');
        return;
    }

    // Создаем временный URL для изображения
    const mapUrl = URL.createObjectURL(file);

    // Инициализируем карту (размеры в пикселях)
    initMap(cols, rows, mapUrl);

    // Закрываем модальное окно
    const modal = bootstrap.Modal.getInstance(document.getElementById('importModal'));
    if (modal) modal.hide();

    // Сбрасываем форму
    document.getElementById('map-import-form').reset();
});

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function () {
    // Скрываем индикатор загрузки при старте
    document.getElementById('loading-overlay').classList.add('hidden');
    updateMeasurementsList();

    // Переключатель тем
    const themeToggle = document.getElementById('theme-toggle');
    const currentTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', currentTheme);
    updateThemeToggleText(currentTheme);

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeToggleText(newTheme);
    });

    function updateThemeToggleText(theme) {
        const icon = themeToggle.querySelector('i');
        const text = themeToggle.querySelector('span');

        if (theme === 'dark') {
            icon.className = 'bi bi-sun';
            text.textContent = 'Светлая тема';
        } else {
            icon.className = 'bi bi-moon';
            text.textContent = 'Темная тема';
        }
    }

    // Очистка при закрытии страницы
    window.addEventListener('beforeunload', function () {
        if (currentMapImageUrl) {
            URL.revokeObjectURL(currentMapImageUrl);
        }
    });

    // Скрытие контекстного меню при клике в другом месте
    document.addEventListener('click', hideContextMenu);
});

// Обработчики кнопок импорта
document.getElementById('import-map-btn').addEventListener('click', function () {
    const modal = new bootstrap.Modal(document.getElementById('importModal'));
    modal.show();
});

document.getElementById('start-import').addEventListener('click', function () {
    const modal = new bootstrap.Modal(document.getElementById('importModal'));
    modal.show();
});

// Обновлённая логика при наведении на цель
map.on('pointermove', (e) => {
    if (!ballisticTable) return;

    const features = map.getFeaturesAtPixel(e.pixel);
    const targetFeature = features.find(f => f.get('type') === 'target');

    if (targetFeature && currentMortar) {
        const params = calculateShotParameters(
            currentMortar.getProperties(),
            targetFeature.getProperties()
        );

        // Отображение данных в popup
        showBallisticPopup(e.coordinate, params);

        // Отрисовка траектории
        drawTrajectory(
            currentMortar.getGeometry().getCoordinates(),
            targetFeature.getGeometry().getCoordinates(),
            params.elevation
        );
    }
});

// Функция отрисовки траектории
function drawTrajectory(start, end, elevationAngle) {
    const trajectoryPoints = generateTrajectoryPoints(start, end, elevationAngle);
    const trajectoryFeature = new ol.Feature({
        geometry: new ol.geom.LineString(trajectoryPoints),
        type: 'trajectory'
    });

    // Стиль с анимацией
    const style = new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: [255, 0, 0, 0.7],
            width: 2,
            lineDash: [5, 5]
        })
    });

    // Добавление на карту
    vectorLayer.getSource().addFeature(trajectoryFeature);
}