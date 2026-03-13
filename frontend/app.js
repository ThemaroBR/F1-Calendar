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

const PREFETCH_PAST_RESULTS = 0;
const OPENF1_YEAR = 2026;

const TZ_STORAGE_KEY = 'f1_timezone';
let currentTimezone = '';

const _ESCAPE_LOOKUP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

function escapeHtml(value) {
    if (value == null) return '';
    return String(value).replace(/[&<>"']/g, (match) => _ESCAPE_LOOKUP[match]);
}

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

function isForceLiveEnabled() {
    try {
        const params = new URLSearchParams(window.location.search);
        return params.get('force_live') === '1';
    } catch (e) {
        return false;
    }
}

function getSessionDurationMinutes(sessionName) {
    const normalized = normalizeSessionLabel(sessionName);
    if (normalized === 'Race') return 120;
    if (normalized === 'Sprint') return 60;
    if (normalized === 'Qualifying') return 60;
    if (normalized === 'Sprint Qualifying') return 60;
    if (normalized.startsWith('Free Practice')) return 60;
    return 60;
}

function getLiveSessionName(race, now) {
    const entries = Object.entries(race.sessions);
    for (const [name, when] of entries) {
        const start = new Date(when);
        if (Number.isNaN(start.getTime())) continue;
        const durationMs = getSessionDurationMinutes(name) * 60 * 1000;
        const end = new Date(start.getTime() + durationMs);
        if (now >= start && now <= end) return normalizeSessionLabel(name);
    }
    return '';
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
    try {
        if (currentTimezone) {
            localStorage.setItem(TZ_STORAGE_KEY, currentTimezone);
        } else {
            localStorage.removeItem(TZ_STORAGE_KEY);
        }
    } catch (e) {
        // Ignore storage errors (private mode, quota, etc.)
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

function renderRaceItem(race, index, nextRaceName, now, podium, driversBySession, isLive, liveSessionName) {
    const weekendDate = formatWeekendDate(race.start);
    const flagUrl = flagUrlForRace(race);
    const flagLabel = race.country_name ? `${race.country_name} flag` : 'Country flag';
    const sprintBadge = Object.keys(race.sessions).some((name) => normalizeSessionLabel(name).includes('Sprint'));
    const isNext = nextRaceName && race.name === nextRaceName;
    const past = isPastRace(race, now);
    const badge = isNext ? '<span class="badge badge-next">Next</span>' : '';
    const sprint = sprintBadge ? '<span class="badge badge-sprint">Sprint</span>' : '';
    const liveBadge = isLive
        ? '<a class="badge badge-live" href="https://www.formula1.com/" target="_blank" rel="noopener"><span class="badge-live-dot"></span>Live</a>'
        : '';
    const done = past && (!podium || !podium.length) ? '<span class="badge badge-done">Finished</span>' : '';
    const badges = isLive ? `${liveBadge}` : `${sprint}${badge}${done}`;
    const locationLabel = race.country_name || race.track;
    const rowNumber = String(index + 1).padStart(2, '0');
    const podiumHtml = past && podium && podium.length ? renderPodium(podium) : '';
    const safeRaceName = escapeHtml(race.name);
    const safeTrack = escapeHtml(race.track);
    const safeLocation = escapeHtml(locationLabel);
    const safeFlagLabel = escapeHtml(flagLabel);
    const raceKey = encodeURIComponent(race.name || '');

    return `
        <div class="race-item ${isNext ? 'is-next' : ''} ${past ? 'is-past' : ''} ${isLive ? 'is-live' : ''}" data-race="${raceKey}">
            <div class="race-row">
                <span class="race-num">${rowNumber}</span>
                <div class="race-info">
                    <span class="race-name">${safeRaceName} <span class="chevron">></span></span>
                    <span class="race-circuit">
                        ${flagUrl ? `<img class="track-flag" src="${flagUrl}" alt="${safeFlagLabel}" loading="lazy">` : ''}
                        <span>${safeTrack}</span>
                    </span>
                </div>
                <div class="race-podium-slot">${podiumHtml || ''}</div>
                <span class="race-date">${weekendDate}</span>
                <span class="race-location">${safeLocation}</span>
                <div class="race-badge">${badges}</div>
            </div>
            ${isLive ? `
                <div class="live-row">
                    <a class="live-row-link" href="https://www.formula1.com/" target="_blank" rel="noopener">
                        <span class="live-row-dot"></span>
                        <span class="live-row-label">${escapeHtml(liveSessionName || 'Weekend')} — In Progress</span>
                        <span class="live-row-cta">Watch on F1 TV</span>
                        <span class="live-row-arrow">→</span>
                    </a>
                </div>
            ` : ''}
            <div class="sessions">
                ${renderSessions(race, driversBySession)}
            </div>
        </div>
    `;
}

// Tracks which race names have already had their results fetched,
// so expanding the same row twice never triggers a second API call.
const _fetchedRaces = new Set();

function renderRaces(races, nextRaceName, raceResults, liveRaceName, liveSessionName) {
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
            const isLive = liveRaceName && race.name === liveRaceName;
            const sessionLabel = isLive ? liveSessionName : '';
            return renderRaceItem(race, index, nextRaceName, now, podium, driversBySession, isLive, sessionLabel);
        })
        .join('');

    raceListEl.querySelectorAll('.race-item').forEach((item) => {
        const sessions = item.querySelector('.sessions');
        // Sessions are always collapsed on fresh render; no open-state to restore.

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

            if (!isOpening) return;

            const raceName = item.dataset.race ? decodeURIComponent(item.dataset.race) : '';
            if (!raceName || _fetchedRaces.has(raceName)) return;
            const race = races.find((r) => r.name === raceName);
            if (!race || !isPastRace(race, now)) return;

            // Mark as fetched optimistically; rolled back on error so the user can retry.
            _fetchedRaces.add(raceName);
            const podiumSlot = item.querySelector('.race-podium-slot');
            if (podiumSlot) {
                podiumSlot.innerHTML = '<div class="race-podium podium-skeleton"></div>';
            }

            const loadingRow = document.createElement('div');
            loadingRow.className = 'session-row session-loading';
            loadingRow.innerHTML = '<span></span><span class="session-name" style="color:var(--muted)">Loading results\u2026</span>';
            sessions.prepend(loadingRow);

            try {
                const meetingKey = await fetchMeetingKey(race);
                if (!meetingKey) return;
                const result = await fetchRaceResults(race, meetingKey);

                if (podiumSlot) {
                    podiumSlot.innerHTML = result.podium && result.podium.length
                        ? renderPodium(result.podium)
                        : '';
                }

                sessions.innerHTML = renderSessions(race, result.sessions);
            } catch (e) {
                _fetchedRaces.delete(raceName);   // allow retry on next expand
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
const _openF1Cache = new Map();
const _OPENF1_CACHE_MAX = 200;
const _OPENF1_TTL = {
    session_result: 24 * 60 * 60 * 1000,
    drivers: 24 * 60 * 60 * 1000,
    sessions: 60 * 60 * 1000,
    meetings: 60 * 60 * 1000,
    laps: 24 * 60 * 60 * 1000,
    default: 5 * 60 * 1000
};
const _requestQueue = [];
let _activeRequests = 0;
const _MAX_CONCURRENT_REQUESTS = 1;
const _MIN_REQUEST_GAP_MS = 400;
let _lastRequestTime = 0;
let _backoffUntil = 0;

function _resourceFromPath(path) {
    const match = path.match(/^\/([^?]+)/);
    return match ? match[1] : '';
}

function _cacheGet(path) {
    const entry = _openF1Cache.get(path);
    if (!entry) return null;
    if (Date.now() < entry.expiresAt) return entry.data;
    _openF1Cache.delete(path);
    return null;
}

function _cacheSet(path, data) {
    const resource = _resourceFromPath(path);
    const ttl = _OPENF1_TTL[resource] || _OPENF1_TTL.default;
    _openF1Cache.set(path, { expiresAt: Date.now() + ttl, data, touchedAt: Date.now() });
    if (_openF1Cache.size > _OPENF1_CACHE_MAX) {
        const entries = Array.from(_openF1Cache.entries());
        entries.sort((a, b) => a[1].touchedAt - b[1].touchedAt);
        const toEvict = entries.slice(0, Math.ceil(_OPENF1_CACHE_MAX * 0.2));
        toEvict.forEach(([key]) => _openF1Cache.delete(key));
    }
}

async function _processRequestQueue() {
    while (_activeRequests < _MAX_CONCURRENT_REQUESTS && _requestQueue.length > 0) {
        if (Date.now() < _backoffUntil) {
            const wait = _backoffUntil - Date.now();
            await new Promise((resolve) => setTimeout(resolve, wait));
        }
        _activeRequests++;
        const requestFn = _requestQueue.shift();
        try {
            await requestFn();
        } finally {
            _activeRequests--;
        }
    }
}

function _queueOpenF1Request(path) {
    const cached = _cacheGet(path);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve) => {
        _requestQueue.push(async () => {
            try {
                const sinceLast = Date.now() - _lastRequestTime;
                if (sinceLast < _MIN_REQUEST_GAP_MS) {
                    await new Promise((r) => setTimeout(r, _MIN_REQUEST_GAP_MS - sinceLast));
                }
                const res = await fetch(openF1Base + path);
                _lastRequestTime = Date.now();
                if (!res.ok) {
                    if (res.status === 429) {
                        _backoffUntil = Date.now() + 30000;
                    }
                    resolve(null);
                    return;
                }
                const data = await res.json();
                _cacheSet(path, data);
                resolve(data);
            } catch (e) {
                console.warn('OpenF1 fetch failed:', path, e);
                resolve(null);
            }
        });
        _processRequestQueue();
    });
}

async function fetchOpenF1(path) {
    return _queueOpenF1Request(path);
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

async function fetchFastestDriver(sessionKey) {
    const results = await fetchOpenF1(`/session_result?session_key=${sessionKey}&position=1`);
    if (!results || !results.length) return null;
    const driverMap = await fetchDriverMap(sessionKey);
    return driverMap[results[0].driver_number] || null;
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
            const driver = await fetchFastestDriver(sessionKey);
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
    const data = await fetchOpenF1(`/meetings?year=${OPENF1_YEAR}`);
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
        const [races] = await Promise.all([
            fetchJSON(apiUrl('/races'))
        ]);
        const sortedRaces = [...races].sort((a, b) => new Date(a.start) - new Date(b.start));
        const filteredRaces = filterUnofficialRaces(sortedRaces);
        const now = new Date();
        const forceLive = isForceLiveEnabled();
        const nextRaceName = filteredRaces.find((race) => new Date(race.start) > now)?.name || null;
        const liveRace = forceLive
            ? (filteredRaces.find((race) => race.name === nextRaceName) || filteredRaces[0] || null)
            : (filteredRaces.find((race) => getLiveSessionName(race, now)) || null);
        const liveRaceName = liveRace ? liveRace.name : null;
        const liveSessionName = liveRace ? (forceLive ? '' : getLiveSessionName(liveRace, now)) : '';
        totalWeekendsEl.textContent = String(filteredRaces.length);
        totalSprintsEl.textContent = String(getSprintCount(filteredRaces));
        formatSeasonRange(filteredRaces);
        renderRaces(filteredRaces, nextRaceName, null, liveRaceName, liveSessionName);

        const pastRaces = filteredRaces.filter((race) => isPastRace(race, now));
        const racesToPrefetch = PREFETCH_PAST_RESULTS > 0
            ? pastRaces.slice(-PREFETCH_PAST_RESULTS)
            : [];
        if (racesToPrefetch.length) {
            const raceResults = await fetchAllRaceResults(racesToPrefetch);
            renderRaces(filteredRaces, nextRaceName, raceResults, liveRaceName, liveSessionName);
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


try {
    const storedTimezone = localStorage.getItem(TZ_STORAGE_KEY);
    if (storedTimezone) {
        currentTimezone = storedTimezone;
    }
} catch (e) {
    currentTimezone = '';
}
updateTimezoneLabel();
updateTimezoneOptions();

fetchAndRender();
