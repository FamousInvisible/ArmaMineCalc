        // Функции для работы с баллистической таблицей
        function addRow(ring) {
            const table = document.querySelector(`#table-ring${ring} tbody`) || 
                        document.querySelector(`#table-ring${ring}`);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><input type="number" class="form-control form-control-sm range-input" step="0.1"></td>
                <td><input type="number" class="form-control form-control-sm elev-input" step="0.1"></td>
                <td><input type="number" class="form-control form-control-sm corr-input" step="0.1"></td>
                <td><input type="number" class="form-control form-control-sm flight-input" step="0.1"></td>
                <td><button class="btn btn-sm btn-danger" onclick="this.closest('tr').remove()"><i class="bi bi-trash"></i></button></td>
            `;
            
            table.appendChild(row);
        }

        function saveBallisticTable() {
            const data = {
                fraction: document.getElementById('fraction-select').value,
                ammoType: document.getElementById('ammo-type').value,
                elevationData: {}
            };

            // Сбор данных для всех колец (0-4)
            for (let ring = 0; ring <= 4; ring++) {
                data.elevationData[ring] = [];
                
                document.querySelectorAll(`#table-ring${ring} tr`).forEach(row => {
                    const rangeInput = row.querySelector('.range-input');
                    const elevInput = row.querySelector('.elev-input');
                    const corrInput = row.querySelector('.corr-input');
                    const flightInput = row.querySelector('.flight-input');
                    
                    if (rangeInput && elevInput && corrInput && flightInput &&
                        rangeInput.value && elevInput.value && corrInput.value && flightInput.value) {
                        data.elevationData[ring].push({
                            range: parseFloat(rangeInput.value),
                            elevation: parseFloat(elevInput.value),
                            correction: parseFloat(corrInput.value),
                            flight: parseFloat(flightInput.value)
                        });
                    }
                });
            }

            // Создание и скачивание JSON-файла
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `ballistic_table_${data.fraction}_${data.ammoType}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
        }

        // Инициализация таблиц при загрузке
        document.addEventListener('DOMContentLoaded', () => {
            for (let ring = 0; ring <= 4; ring++) {
                // Добавляем по 5 пустых строк в каждую таблицу
                for (let i = 0; i < 5; i++) {
                    addRow(ring);
                }
            }
            
            // Обновление размера карты при переключении вкладок
            document.getElementById('mainTabs').addEventListener('shown.bs.tab', function (event) {
                if (event.target.id === 'map-tab' && window.map) {
                    setTimeout(() => {
                        map.updateSize();
                    }, 100);
                }
            });
        });