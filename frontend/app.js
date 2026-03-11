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

const tzPill = document.getElementById('tz-pill');
const tzLabel = document.getElementById('tz-label');
const tzPanel = document.getElementById('tz-panel');
const tzSelect = document.getElementById('tz');
const tzApply = document.getElementById('tz-apply');
const statusEl = document.getElementById('status');
const totalWeekendsEl = document.getElementById('total-weekends');
const totalSprintsEl = document.getElementById('total-sprints');
const seasonRangeEl = document.getElementById('season-range');
const raceListEl = document.getElementById('race-list');

const weekendFormatter = new Intl.DateTimeFormat([], { month: 'short', day: '2-digit' });
const sessionDayFormatter = new Intl.DateTimeFormat([], { month: 'short', day: '2-digit' });
const sessionTimeFormatter = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false });
const monthFormatter = new Intl.DateTimeFormat([], { month: 'short' });

function normalizeSessionLabel(label) {
    return SESSION_LABELS[label] || label;
}

function sessionOrder(name) {
    return SESSION_PRIORITY[name] || 99;
}

function formatDateParts(value) {
    const date = new Date(value);
    return {
        day: sessionDayFormatter.format(date),
        time: sessionTimeFormatter.format(date)
    };
}

function formatWeekendDate(value) {
    return weekendFormatter.format(new Date(value));
}

function getTimezoneValue() {
    return tzSelect.value.trim();
}

function getDisplayTimezone() {
    const selected = getTimezoneValue();
    if (selected) {
        return selected;
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function updateTimezoneLabel() {
    tzLabel.textContent = getDisplayTimezone();
}

function apiUrl(path) {
    const url = new URL(apiBase + path);
    const tz = getTimezoneValue();
    if (tz) {
        url.searchParams.set('tz', tz);
    }
    return url;
}

function setStatus(message) {
    statusEl.textContent = message;
}

function flagUrlForRace(race) {
    if (!race.country_code) {
        return null;
    }
    return `https://flagcdn.com/w20/${race.country_code.toLowerCase()}.png`;
}

function formatSeasonRange(races) {
    if (!races.length) {
        seasonRangeEl.textContent = '';
        return;
    }
    const sorted = [...races].sort((a, b) => new Date(a.start) - new Date(b.start));
    const start = new Date(sorted[0].start);
    const end = new Date(sorted[sorted.length - 1].start);
    const startLabel = monthFormatter.format(start).toUpperCase();
    const endLabel = monthFormatter.format(end).toUpperCase();
    seasonRangeEl.textContent = `${startLabel} - ${endLabel} 2026`;
}

function getSprintCount(races) {
    return races.reduce((count, race) => {
        const hasSprint = Object.keys(race.sessions).some((name) => normalizeSessionLabel(name).includes('Sprint'));
        return hasSprint ? count + 1 : count;
    }, 0);
}

function filterUnofficialRaces(races) {
    let bahrainMatches = 0;
    return races.filter((race) => {
        if (/bahrain/i.test(race.name)) {
            bahrainMatches += 1;
            return bahrainMatches > 2;
        }
        return true;
    });
}

function isPastRace(race, now) {
    return new Date(race.start) < now;
}

function renderSessions(race) {
    const rows = Object.entries(race.sessions)
        .map(([name, when]) => ({ name: normalizeSessionLabel(name), when }))
        .sort((a, b) => {
            const byOrder = sessionOrder(a.name) - sessionOrder(b.name);
            if (byOrder !== 0) {
                return byOrder;
            }
            return new Date(a.when) - new Date(b.when);
        });

    return rows.map((session) => {
        const parts = formatDateParts(session.when);
        return `
            <div class="session-row">
                <span></span>
                <span class="session-name">${session.name}</span>
                <span class="session-date">${parts.day}</span>
                <span class="session-time">${parts.time}</span>
                <span></span>
            </div>
        `;
    }).join('');
}

function renderRaceItem(race, index, nextRaceName, now) {
    const weekendDate = formatWeekendDate(race.start);
    const flagUrl = flagUrlForRace(race);
    const flagLabel = race.country_name ? `${race.country_name} flag` : 'Country flag';
    const sprintBadge = Object.keys(race.sessions).some((name) => normalizeSessionLabel(name).includes('Sprint'));
    const isNext = nextRaceName && race.name === nextRaceName;
    const past = isPastRace(race, now);
    const badge = isNext ? '<span class="badge badge-next">Next</span>' : '';
    const sprint = sprintBadge ? '<span class="badge badge-sprint">Sprint</span>' : '';
    const done = past ? '<span class="badge badge-done">Finished</span>' : '';
    const badges = `<div class="race-badge">${sprint}${badge}${done}</div>`;
    const locationLabel = race.country_name || race.track;
    const rowNumber = String(index + 1).padStart(2, '0');

    return `
        <div class="race-item ${isNext ? 'is-next' : ''} ${past ? 'is-past' : ''}" data-race="${race.name}">
            <div class="race-row">
                <span class="race-num">${rowNumber}</span>
                <div class="race-info">
                    <span class="race-name">${race.name} <span class="chevron">></span></span>
                    <span class="race-circuit">
                        ${flagUrl ? `<img class="track-flag" src="${flagUrl}" alt="${flagLabel}" loading="lazy">` : ''}
                        <span>${race.track}</span>
                    </span>
                </div>
                <span class="race-date">${weekendDate}</span>
                <span class="race-location">${locationLabel}</span>
                ${badges}
            </div>
            <div class="sessions ${isNext ? 'open' : ''}">
                ${renderSessions(race)}
            </div>
        </div>
    `;
}

function renderRaces(races, nextRaceName) {
    if (!races.length) {
        raceListEl.innerHTML = '<div class="empty-state">No race weekends available right now.</div>';
        return;
    }

    const now = new Date();
    raceListEl.innerHTML = races
        .map((race, index) => renderRaceItem(race, index, nextRaceName, now))
        .join('');

    raceListEl.querySelectorAll('.race-item').forEach((item) => {
        item.addEventListener('click', () => {
            const sessions = item.querySelector('.sessions');
            if (!sessions) {
                return;
            }
            sessions.classList.toggle('open');
            item.classList.toggle('open');
        });
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
        const filteredRaces = filterUnofficialRaces(sortedRaces);
        totalWeekendsEl.textContent = String(filteredRaces.length);
        totalSprintsEl.textContent = String(getSprintCount(filteredRaces));
        formatSeasonRange(filteredRaces);
        renderRaces(filteredRaces, nextRace ? nextRace.name : null);
    } catch (error) {
        setStatus(`Could not load schedule: ${error.message}`);
        raceListEl.innerHTML = '<div class="empty-state">No race weekends available right now.</div>';
        totalWeekendsEl.textContent = '0';
        totalSprintsEl.textContent = '0';
        seasonRangeEl.textContent = '';
    }
}

function toggleTimezonePanel() {
    tzPanel.classList.toggle('active');
}

tzPill.addEventListener('click', toggleTimezonePanel);
tzApply.addEventListener('click', (event) => {
    event.preventDefault();
    toggleTimezonePanel();
    fetchAndRender();
});

fetchAndRender();
