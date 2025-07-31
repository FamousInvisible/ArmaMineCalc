// Расчёт азимута между точками
export function calculateAzimuth(coords1, coords2) {
    const [lon1, lat1] = coords1;
    const [lon2, lat2] = coords2;

    const dLon = lon2 - lon1;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Поправка на кривизну Земли
export function adjustForEarthCurvature(distance, height) {
    const earthRadius = 6371000; // м
    return height - (distance ** 2) / (2 * earthRadius);
}