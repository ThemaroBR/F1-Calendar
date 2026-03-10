const apiBase = 'http://127.0.0.1:8000';
const SESSION_LABELS = {
    FP1: 'Free Practice 1',
    FP2: 'Free Practice 2',
    FP3: 'Free Practice 3',
    Race: 'Race',
    Qualifying: 'Qualifying',
    Sprint: 'Sprint',
    'Sprint Qualifying': 'Sprint Qualifying'
};
const SESSION_PRIORITY = {
    'Free Practice 1': 1,
    'Free Practice 2': 2,
    'Free Practice 3': 3,
    'Sprint Qualifying': 4,
    Sprint: 5,
    Qualifying: 6,
    Race: 7
};

const timezoneLabel = document.getElementById('timezone-label');
const timezoneEditor = document.getElementById('timezone-editor');
const timezoneSelect = document.getElementById('tz');
const statusEl = document.getElementById('status');
const scheduleMeta = document.getElementById('schedule-meta');
const racesEl = document.getElementById('races');
const weekendFormatter = new Intl.DateTimeFormat([], { month: 'short', day: '2-digit' });
const sessionDayFormatter = new Intl.DateTimeFormat([], { month: 'short', day: '2-digit' });
const sessionTimeFormatter = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false });

function formatDateParts(value) {
    const date = new Date(value);
    return {
        day: sessionDayFormatter.format(date),
        time: sessionTimeFormatter.format(date)
    };
}

function getTimezoneValue() {
    return timezoneSelect.value.trim();
}

function getDisplayTimezone() {
    const selected = getTimezoneValue();
    if (selected) {
        return selected;
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function updateTimezoneLabel() {
    timezoneLabel.textContent = getDisplayTimezone();
}

function apiUrl(path) {
    const url = new URL(apiBase + path);
    const tz = getTimezoneValue();
    if (tz) {
        url.searchParams.set('tz', tz);
    }
    return url;
}

function normalizeSessionLabel(label) {
    return SESSION_LABELS[label] || label;
}

function sessionOrder(name) {
    return SESSION_PRIORITY[name] || 99;
}

function setStatus(message) {
    statusEl.textContent = message;
}

function formatWeekendDate(value) {
    return weekendFormatter.format(new Date(value));
}

function updateScheduleMeta(count) {
    scheduleMeta.textContent = `Showing ${count} race weekends for 2026`;
}

function flagUrlForRace(race) {
    if (!race.country_code) {
        return null;
    }
    return `https://flagcdn.com/w20/${race.country_code.toLowerCase()}.png`;
}

function renderRaces(races, nextRaceName) {
    racesEl.innerHTML = '';

    if (!races.length) {
        racesEl.innerHTML = '<div class="empty-state">No race weekends available right now.</div>';
        return;
    }

    races.forEach((race, index) => {
        const block = document.createElement('details');
        block.className = 'race-block';
        block.open = nextRaceName ? race.name === nextRaceName : index === 0;

        const summary = document.createElement('summary');
        summary.className = 'race-summary';
        const weekendDate = formatWeekendDate(race.start);
        const flagUrl = flagUrlForRace(race);
        const flagLabel = race.country_name ? `${race.country_name} flag` : 'Country flag';
        summary.innerHTML = `
            <div class="race-main">
                <span class="caret">${block.open ? 'v' : '>'}</span>
                <span class="race-name">${race.name}</span>
                ${nextRaceName === race.name ? '<span class="next-badge">Next</span>' : ''}
            </div>
            <span class="race-meta">
                <span class="track-group">
                    ${flagUrl ? `<img class="track-flag" src="${flagUrl}" alt="${flagLabel}" loading="lazy">` : ''}
                    <span class="track-name">${race.track}</span>
                </span>
                <span class="track-sep">|</span>
                <span class="track-date">${weekendDate}</span>
            </span>
        `;
        block.appendChild(summary);

        const rows = Object.entries(race.sessions)
            .map(([name, when]) => ({ name: normalizeSessionLabel(name), when }))
            .sort((a, b) => {
                const byOrder = sessionOrder(a.name) - sessionOrder(b.name);
                if (byOrder !== 0) {
                    return byOrder;
                }
                return new Date(a.when) - new Date(b.when);
            });

        rows.forEach((session) => {
            const parts = formatDateParts(session.when);
            const row = document.createElement('div');
            row.className = 'session-row';
            row.innerHTML = `
                <span class="session-name">${session.name}</span>
                <span class="session-date">${parts.day}</span>
                <span class="session-time">${parts.time}</span>
            `;
            block.appendChild(row);
        });

        block.addEventListener('toggle', () => {
            const caret = block.querySelector('.caret');
            if (caret) {
                caret.textContent = block.open ? 'v' : '>';
            }
        });

        racesEl.appendChild(block);
    });
}

async function fetchJSON(url) {
    const response = await fetch(url);
    if (!response.ok) {
        let detail = `${response.status}`;
        try {
            const payload = await response.json();
            if (payload.detail) {
                detail = payload.detail;
            }
        } catch (e) {}
        throw new Error(detail);
    }
    return response.json();
}

async function fetchAndRender() {
    setStatus('');
    updateTimezoneLabel();
    try {
        const [races, nextRace] = await Promise.all([
            fetchJSON(apiUrl('/races')),
            fetchJSON(apiUrl('/races/next')).catch(() => null)
        ]);
        const sortedRaces = [...races].sort((a, b) => new Date(a.start) - new Date(b.start));
        updateScheduleMeta(sortedRaces.length);
        renderRaces(sortedRaces, nextRace ? nextRace.name : null);
    } catch (error) {
        setStatus(`Could not load schedule: ${error.message}`);
        racesEl.innerHTML = '';
        updateScheduleMeta(0);
    }
}

document.getElementById('toggle-timezone').addEventListener('click', () => {
    timezoneEditor.classList.toggle('active');
});

timezoneEditor.addEventListener('submit', (event) => {
    event.preventDefault();
    fetchAndRender();
});

timezoneLabel.addEventListener('click', (event) => {
    event.preventDefault();
    timezoneEditor.classList.toggle('active');
});

fetchAndRender();
