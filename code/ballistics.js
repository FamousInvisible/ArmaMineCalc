import { calculateAzimuth } from './utils.js'; // Утилита для расчёта азимута

let ballisticTable = null;
let currentMortar = null;
let currentTargets = [];

// Загрузка и валидация таблицы
export function importBallisticTable(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            // Проверка структуры таблицы
            if (!data.nation || !data.ammoType || !data.table || !Array.isArray(data.table)) {
                throw new Error("Некорректный формат таблицы");
            }

            ballisticTable = {
                nation: data.nation,
                ammoType: data.ammoType,
                table: new Map(data.table.map(entry => [entry.distance, entry]))
            };

            initElevationControls();
            alert(`Таблица загружена: ${data.nation} / ${data.ammoType}`);
        } catch (error) {
            console.error("Ошибка загрузки таблицы:", error);
            alert("Ошибка формата файла");
        }
    };
    reader.readAsText(file);
}

// Инициализация элементов управления высотами
function initElevationControls() {
    // Логика добавления полей ввода высоты для точек
    document.querySelectorAll('.point').forEach(point => {
        const input = document.createElement('input');
        input.type = "number";
        input.className = "elevation-input";
        input.placeholder = "Высота (м)";
        point.appendChild(input);
    });
}

// Расчёт параметров стрельбы
export function calculateShotParameters(mortar, target) {
    if (!ballisticTable) return null;

    // Расчёт дистанции с учётом высот
    const horizontalDist = ol.sphere.getDistance(mortar.coords, target.coords);
    const elevationDiff = (target.elevation || 0) - (mortar.elevation || 0);
    const actualDistance = Math.sqrt(horizontalDist ** 2 + elevationDiff ** 2);

    // Поиск ближайшей дистанции в таблице
    let bestEntry = null;
    let minRingCount = Infinity;
    let minDistanceDiff = Infinity;

    ballisticTable.table.forEach((entry, tableDistance) => {
        const distanceDiff = Math.abs(actualDistance - tableDistance);
        const rings = Math.min(...entry.rings.map(r => r.ring));

        if (rings < minRingCount || (rings === minRingCount && distanceDiff < minDistanceDiff)) {
            bestEntry = entry;
            minRingCount = rings;
            minDistanceDiff = distanceDiff;
        }
    });

    // Расчёт азимута (в милах)
    const azimuthDeg = calculateAzimuth(mortar.coords, target.coords);
    const mils = ballisticTable.nation === "USA" ? azimuthDeg * (6400 / 360) : azimuthDeg * (6000 / 360);

    return {
        distance: actualDistance,
        azimuth: mils.toFixed(0),
        ring: minRingCount,
        elevation: bestEntry.rings.find(r => r.ring === minRingCount).angle,
        time: bestEntry.rings.find(r => r.ring === minRingCount).time
    };
}

// Генерация точек траектории
export function generateTrajectoryPoints(start, end, elevationAngle, pointCount = 20) {
    const points = [];
    const heightFactor = Math.sin((elevationAngle * Math.PI) / 180);

    for (let i = 0; i <= pointCount; i++) {
        const ratio = i / pointCount;
        const lat = start[0] + (end[0] - start[0]) * ratio;
        const lon = start[1] + (end[1] - start[1]) * ratio;

        // Параболическая аппроксимация
        const heightOffset = 4 * heightFactor * ratio * (1 - ratio);
        points.push([lat, lon, heightOffset]);
    }

    return points;
}