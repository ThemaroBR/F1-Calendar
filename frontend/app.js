const apiBase = window.API_BASE || 'http://127.0.0.1:8000';
const SESSION_LABELS = {
    FP1: 'Free Practice 1',
    FP2: 'Free Practice 2',
    FP3: 'Free Practice 3',
    Qualifying: 'Qualifying',
    Race: 'Race',
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
const tzOptions = Array.from(document.querySelectorAll('.tz-option'));
const statusEl = document.getElementById('status');
const totalWeekendsEl = document.getElementById('total-weekends');
const totalSprintsEl = document.getElementById('total-sprints');
const seasonRangeEl = document.getElementById('season-range');
const raceListEl = document.getElementById('race-list');

const TZ_STORAGE_KEY = 'f1_timezone';
let currentTimezone = '';

function getFormatter(options) {
    return new Intl.DateTimeFormat([], { timeZone: getDisplayTimezone(), ...options });
}

function normalizeSessionLabel(label) {
    return SESSION_LABELS[label] || label;
}

function sessionOrder(name) {
    return SESSION_PRIORITY[name] || 99;
}

function formatDateParts(value) {
    const date = new Date(value);
    return {
        day: getFormatter({ month: 'short', day: '2-digit' }).format(date),
        time: getFormatter({ hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
    };
}

function formatWeekendDate(value) {
    return getFormatter({ month: 'short', day: '2-digit' }).format(new Date(value));
}

function getTimezoneValue() {
    return currentTimezone;
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

function updateTimezoneOptions() {
    tzOptions.forEach((option) => {
        const isActive = option.dataset.value === currentTimezone;
        option.classList.toggle('active', isActive);
        option.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
}

function setTimezoneValue(value) {
    currentTimezone = value || '';
    if (currentTimezone) {
        localStorage.setItem(TZ_STORAGE_KEY, currentTimezone);
    } else {
        localStorage.removeItem(TZ_STORAGE_KEY);
    }
    updateTimezoneLabel();
    updateTimezoneOptions();
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
    const fmt = getFormatter({ month: 'short' });
    const startLabel = fmt.format(start).toUpperCase();
    const endLabel = fmt.format(end).toUpperCase();
    seasonRangeEl.textContent = `${startLabel} - ${endLabel} 2026`;
}

function getSprintCount(races) {
    return races.reduce((count, race) => {
        const hasSprint = Object.keys(race.sessions).some((name) => normalizeSessionLabel(name).includes('Sprint'));
        return hasSprint ? count + 1 : count;
    }, 0);
}

// NOTE: The API returns 2 unofficial pre-season Bahrain test/exhibition events
// before the actual Bahrain Grand Prix. We skip the first two Bahrain entries
// here until the API exposes an official flag to filter them directly.
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
    // Use the latest session time if available, so a race in progress isn't marked as past
    const sessionTimes = Object.values(race.sessions).map((t) => new Date(t));
    const lastSession = sessionTimes.length
        ? new Date(Math.max(...sessionTimes))
        : new Date(race.start);
    return lastSession < now;
}

function renderSessions(race, driversBySession) {
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
        const driver = driversBySession ? driversBySession[session.name] : null;
        const chipHtml = driver ? renderDriverChip(driver) : '';
        return `
            <div class="session-row">
                <span></span>
                <span class="session-name">
                    <span>${session.name}</span>
                    <span class="session-driver">${chipHtml}</span>
                </span>
                <span class="session-date">${parts.day}</span>
                <span class="session-time">${parts.time}</span>
            </div>
        `;
    }).join('');
}

function renderRaceItem(race, index, nextRaceName, now, podium, driversBySession) {
    const weekendDate = formatWeekendDate(race.start);
    const flagUrl = flagUrlForRace(race);
    const flagLabel = race.country_name ? `${race.country_name} flag` : 'Country flag';
    const sprintBadge = Object.keys(race.sessions).some((name) => normalizeSessionLabel(name).includes('Sprint'));
    const isNext = nextRaceName && race.name === nextRaceName;
    const past = isPastRace(race, now);
    const badge = isNext ? '<span class="badge badge-next">Next</span>' : '';
    const sprint = sprintBadge ? '<span class="badge badge-sprint">Sprint</span>' : '';
    const done = past && (!podium || !podium.length) ? '<span class="badge badge-done">Finished</span>' : '';
    const badges = `<div class="race-badge">${sprint}${badge}${done}</div>`;
    const locationLabel = race.country_name || race.track;
    const rowNumber = String(index + 1).padStart(2, '0');
    const podiumHtml = past && podium && podium.length ? renderPodium(podium) : '';

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
                <div class="race-podium-slot">${podiumHtml || ''}</div>
                <span class="race-date">${weekendDate}</span>
                <span class="race-location">${locationLabel}</span>
                <div class="race-right">
                    ${badges}
                </div>
            </div>
            <div class="sessions ${isNext ? 'open' : ''}">
                ${renderSessions(race, driversBySession)}
            </div>
        </div>
    `;
}

// Tracks which race names have already had their results fetched,
// so expanding the same row twice never triggers a second API call.
const _fetchedRaces = new Set();

function renderRaces(races, nextRaceName, raceResults) {
    if (!races.length) {
        raceListEl.innerHTML = '<div class="empty-state">No race weekends available right now.</div>';
        return;
    }

    const now = new Date();
    raceListEl.innerHTML = races
        .map((race, index) => {
            const result = raceResults ? raceResults[race.name] : null;
            const podium = result ? result.podium : null;
            const driversBySession = result ? result.sessions : null;
            return renderRaceItem(race, index, nextRaceName, now, podium, driversBySession);
        })
        .join('');

    raceListEl.querySelectorAll('.race-item').forEach((item) => {
        const sessions = item.querySelector('.sessions');
        if (sessions && sessions.classList.contains('open')) {
            item.classList.add('open');
        }

        item.addEventListener('click', async () => {
            if (!sessions) return;

            const isOpening = !sessions.classList.contains('open');
            if (isOpening) {
                raceListEl.querySelectorAll('.race-item.open').forEach((openItem) => {
                    if (openItem === item) return;
                    openItem.classList.remove('open');
                    const openSessions = openItem.querySelector('.sessions');
                    if (openSessions) {
                        openSessions.classList.remove('open');
                    }
                });
            }
            sessions.classList.toggle('open');
            item.classList.toggle('open');

            // Only fetch results when expanding a past race for the first time
            if (!isOpening) return;
            const raceName = item.dataset.race;
            if (!raceName || _fetchedRaces.has(raceName)) return;
            const race = races.find((r) => r.name === raceName);
            if (!race || !isPastRace(race, now)) return;

            _fetchedRaces.add(raceName);

            // Show a subtle loading indicator inside the sessions panel
            const loadingRow = document.createElement('div');
            loadingRow.className = 'session-row session-loading';
            loadingRow.innerHTML = '<span></span><span class="session-name" style="color:var(--muted)">Loading results\u2026</span>';
            sessions.prepend(loadingRow);

            try {
                const meetingKey = await fetchMeetingKey(race);
                if (!meetingKey) return;
                const result = await fetchRaceResults(race, meetingKey);

                // Update the podium slot in place
                const podiumSlot = item.querySelector('.race-podium-slot');
                if (podiumSlot) {
                    podiumSlot.innerHTML = result.podium && result.podium.length
                        ? renderPodium(result.podium)
                        : '';
                }

                // Replace session rows with enriched version including driver chips
                sessions.innerHTML = renderSessions(race, result.sessions);
            } catch (e) {
                console.warn('Could not load race results for', raceName, e);
            } finally {
                loadingRow.remove();
            }
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
        } catch (e) {
            console.warn('Could not parse error response body', e);
        }
        throw new Error(detail);
    }
    return response.json();
}

const openF1Base = `${apiBase}/openf1`;

async function fetchOpenF1(path) {
    try {
        const res = await fetch(openF1Base + path);
        if (!res.ok) return null;
        return res.json();
    } catch (e) {
        console.warn('OpenF1 fetch failed:', path, e);
        return null;
    }
}

async function fetchDriverMap(sessionKey) {
    const data = await fetchOpenF1(`/drivers?session_key=${sessionKey}`);
    if (!data) return {};
    return Object.fromEntries(data.map((driver) => [driver.driver_number, driver]));
}

async function fetchPodium(raceSessionKey) {
    const [results, driverMap] = await Promise.all([
        fetchOpenF1(`/session_result?session_key=${raceSessionKey}`),
        fetchDriverMap(raceSessionKey)
    ]);
    if (!results || !results.length) return [];
    return [1, 2, 3]
        .map((pos) => results.find((r) => r.position === pos))
        .filter(Boolean)
        .map((r) => driverMap[r.driver_number] || null)
        .filter(Boolean);
}

async function fetchFastestDriver(sessionKey, sessionName) {
    const isQual = sessionName === 'Qualifying' || sessionName === 'Sprint Qualifying';
    if (isQual) {
        const results = await fetchOpenF1(`/session_result?session_key=${sessionKey}&position=1`);
        if (!results || !results.length) return null;
        const driverMap = await fetchDriverMap(sessionKey);
        return driverMap[results[0].driver_number] || null;
    }
    const laps = await fetchOpenF1(`/laps?session_key=${sessionKey}`);
    if (!laps || !laps.length) return null;
    const validLaps = laps.filter((lap) => lap.lap_duration != null && lap.lap_duration > 0);
    if (!validLaps.length) return null;
    validLaps.sort((a, b) => a.lap_duration - b.lap_duration);
    const fastest = validLaps[0];
    const driverMap = await fetchDriverMap(sessionKey);
    return driverMap[fastest.driver_number] || null;
}

const DRIVER_STAT_SESSIONS = new Set([
    'Free Practice 1', 'Free Practice 2', 'Free Practice 3',
    'Sprint Qualifying', 'Qualifying', 'Race'
]);

const SESSION_NAME_TO_OPENF1 = {
    'Free Practice 1': 'Practice 1',
    'Free Practice 2': 'Practice 2',
    'Free Practice 3': 'Practice 3',
    'Sprint Qualifying': 'Sprint Qualifying',
    Qualifying: 'Qualifying',
    Race: 'Race'
};

async function fetchRaceResults(race, meetingKey) {
    const sessionResults = {};
    const sessionEntries = Object.entries(race.sessions)
        .map(([raw]) => normalizeSessionLabel(raw))
        .filter((name) => DRIVER_STAT_SESSIONS.has(name));
    const uniqueSessionNames = [...new Set(sessionEntries)];

    const openF1SessionFetches = uniqueSessionNames.map(async (sessionName) => {
        const openF1Name = SESSION_NAME_TO_OPENF1[sessionName];
        if (!openF1Name) return null;
        const session = await fetchOpenF1(
            `/sessions?meeting_key=${meetingKey}&session_name=${encodeURIComponent(openF1Name)}`
        );
        if (!session || !session.length) return null;
        return { sessionName, sessionKey: session[0].session_key };
    });

    const sessionMetas = (await Promise.all(openF1SessionFetches)).filter(Boolean);
    await Promise.all(sessionMetas.map(async ({ sessionName, sessionKey }) => {
        if (sessionName === 'Race') {
            const podium = await fetchPodium(sessionKey);
            if (podium.length) sessionResults[sessionName] = podium[0];
            sessionResults.__podium = podium;
        } else {
            const driver = await fetchFastestDriver(sessionKey, sessionName);
            if (driver) sessionResults[sessionName] = driver;
        }
    }));

    return {
        podium: sessionResults.__podium || [],
        winner: sessionResults.Race || null,
        sessions: sessionResults
    };
}

async function fetchMeetingKey(race) {
    if (race.meeting_key) {
        return race.meeting_key;
    }
    const data = await fetchOpenF1('/meetings?year=2026');
    if (!data) return null;
    const normalized = race.name.toLowerCase().replace(/\s+grand\s+prix/i, '').trim();
    const match = data.find((meeting) => {
        const meetingName = (meeting.meeting_name || meeting.circuit_short_name || '').toLowerCase();
        return meetingName.includes(normalized) || normalized.includes(meetingName);
    });
    return match ? match.meeting_key : null;
}

async function fetchAllRaceResults(pastRaces) {
    const results = {};
    const CHUNK = 3;
    for (let i = 0; i < pastRaces.length; i += CHUNK) {
        const chunk = pastRaces.slice(i, i + CHUNK);
        await Promise.all(chunk.map(async (race) => {
            const meetingKey = await fetchMeetingKey(race);
            if (!meetingKey) return;
            results[race.name] = await fetchRaceResults(race, meetingKey);
        }));
    }
    return results;
}

function renderDriverChip(driver) {
    if (!driver) return '';
    const color = driver.team_colour ? `#${driver.team_colour}` : 'var(--muted)';
    return `
        <span class="driver-chip">
            <span class="driver-chip-bar" style="background:${color}"></span>
            <span class="driver-chip-acronym" style="color:${color}">${driver.name_acronym}</span>
        </span>
    `;
}

function renderPodium(podium) {
    if (!podium || !podium.length) return '';

    const [p1, p2, p3] = podium;

    function headshot(driver, cls) {
        return driver.headshot_url
            ? `<img class="${cls}" src="${driver.headshot_url}" alt="${driver.full_name}" loading="lazy">`
            : `<span class="${cls}-placeholder"></span>`;
    }

    const p1Color = p1.team_colour ? `#${p1.team_colour}` : 'var(--accent)';

    const othersHtml = [p2, p3].filter(Boolean).map((driver, i) => {
        const pos = i + 2;
        const color = driver.team_colour ? `#${driver.team_colour}` : 'var(--muted)';
        return `
            <div class="podium-entry">
                <span class="podium-entry-bar" style="--entry-color:${color}; background:${color}"></span>
                ${headshot(driver, 'podium-entry-headshot')}
                <span class="podium-entry-pos">${pos}</span>
                <div class="podium-entry-info">
                    <span class="podium-entry-name">${driver.full_name}</span>
                    <span class="podium-entry-team" style="color:${color}">${driver.team_name}</span>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="race-podium">
            <div class="podium-p1" style="--p1-color:${p1Color}">
                ${headshot(p1, 'podium-p1-headshot')}
                <div class="podium-p1-info">
                    <span class="podium-p1-pos" style="color:${p1Color}">&#9651; Winner</span>
                    <span class="podium-p1-name">${p1.full_name}</span>
                    <span class="podium-p1-team" style="color:${p1Color}">${p1.team_name}</span>
                </div>
            </div>
            ${othersHtml ? `<div class="podium-divider"></div><div class="podium-others">${othersHtml}</div>` : ''}
        </div>
    `;
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
        renderRaces(filteredRaces, nextRace ? nextRace.name : null, null);

        const now = new Date();
        const pastRaces = filteredRaces.filter((race) => isPastRace(race, now));
        if (pastRaces.length) {
            const raceResults = await fetchAllRaceResults(pastRaces);
            renderRaces(filteredRaces, nextRace ? nextRace.name : null, raceResults);
        }
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

tzPill.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTimezonePanel();
});

tzPanel.addEventListener('click', (e) => e.stopPropagation());

document.addEventListener('click', () => {
    tzPanel.classList.remove('active');
});

tzOptions.forEach((option) => {
    option.addEventListener('click', (event) => {
        event.preventDefault();
        setTimezoneValue(option.dataset.value || '');
        tzPanel.classList.remove('active');
        fetchAndRender();
    });
});


const storedTimezone = localStorage.getItem(TZ_STORAGE_KEY);
if (storedTimezone) {
    currentTimezone = storedTimezone;
}
updateTimezoneLabel();
updateTimezoneOptions();

fetchAndRender();
