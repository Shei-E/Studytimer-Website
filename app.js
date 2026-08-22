/* ==========================================================================
   Pomodoro Timer - Main Application Logic
   ========================================================================== */

(function () {
  'use strict';

  // --- App State ---
  const state = {
    mode: 'work', // 'work' | 'break'
    timerState: 'stopped', // 'stopped' | 'running' | 'paused' | 'overtime'
    timerHasBeenSet: false, // Tracks if timer has been set for the first time
    workDuration: null, // in seconds (null until set by user)
    breakDuration: 5 * 60, // in seconds (5 mins)
    remainingSeconds: 0,
    overtimeSeconds: 0,
    overtimeEnabled: true,
    timerInterval: null,
    sessionStartTimestamp: null,
    sessionsHistory: [], // Array of { id, startTime, endTime, workSec, otSec, totalSec }
    dailyLog: {},        // Map of "YYYY-MM-DD" -> totalSeconds studied that day
    tasks: [], // Array of { id, text, completed }
    currentPage: 1,
    pageSize: 6,
    summaryTab: 'sessions' // 'sessions' | 'daily'
  };

  // --- DOM Elements ---
  const body = document.body;
  const tabWork = document.getElementById('tabWork');
  const tabBreak = document.getElementById('tabBreak');
  const timerDisplayBox = document.getElementById('timerDisplayBox');
  const timerReadout = document.getElementById('timerReadout');
  const inlineTimeInput = document.getElementById('inlineTimeInput');
  const cancelTimerBtn = document.getElementById('cancelTimerBtn');
  const otBadge = document.getElementById('otBadge');
  const overtimeCheckbox = document.getElementById('overtimeCheckbox');
  const actionBtn = document.getElementById('actionBtn');
  const iconPlay = actionBtn.querySelector('.icon-play');
  const iconPause = actionBtn.querySelector('.icon-pause');
  const iconCheck = actionBtn.querySelector('.icon-check');
  const taskInput = document.getElementById('taskInput');
  const taskSubmitBtn = document.getElementById('taskSubmitBtn');
  const taskList = document.getElementById('taskList');
  const analyticsBtn = document.getElementById('analyticsBtn');
  const summaryPopover = document.getElementById('summaryPopover');
  const summaryCloseBtn = document.getElementById('summaryCloseBtn');
  const statTotalTime = document.getElementById('statTotalTime');
  const statSessionCount = document.getElementById('statSessionCount');
  const sessionsGrid = document.getElementById('sessionsGrid');
  const dailyLogGrid = document.getElementById('dailyLogGrid');
  const summaryTabSessions = document.getElementById('summaryTabSessions');
  const summaryTabDaily = document.getElementById('summaryTabDaily');
  const sessionsPanel = document.getElementById('sessionsPanel');
  const dailyPanel = document.getElementById('dailyPanel');

  // --- Initialization ---
  function init() {
    loadStoredPreferences();
    loadStoredHistory();
    checkDayRollover();
    loadStoredTasks();
    attachEventListeners();
    updateUI();
  }

  // --- LocalStorage Storage ---
  function loadStoredPreferences() {
    try {
      const isSet = localStorage.getItem('pomodoro_timer_set');
      const savedWork = localStorage.getItem('pomodoro_work_duration');
      if (isSet === 'true' && savedWork !== null && savedWork !== 'null' && savedWork !== 'undefined' && savedWork !== '') {
        const parsedWork = parseInt(savedWork, 10);
        if (!isNaN(parsedWork) && parsedWork >= 0) {
          state.timerHasBeenSet = true;
          state.workDuration = parsedWork;
          state.remainingSeconds = state.workDuration;
        } else {
          state.timerHasBeenSet = false;
          state.workDuration = null;
          state.remainingSeconds = 0;
        }
      } else {
        state.timerHasBeenSet = false;
        state.workDuration = null;
        state.remainingSeconds = 0;
      }
      const savedBreak = localStorage.getItem('pomodoro_break_duration');
      if (savedBreak !== null && savedBreak !== 'null' && savedBreak !== 'undefined' && savedBreak !== '') {
        const parsedBreak = parseInt(savedBreak, 10);
        if (!isNaN(parsedBreak) && parsedBreak > 0) {
          state.breakDuration = parsedBreak;
        }
      }
    } catch (e) {
      console.warn('Could not load preferences from localStorage:', e);
    }
  }

  function savePreferences() {
    try {
      if (state.timerHasBeenSet && state.workDuration !== null && !isNaN(state.workDuration)) {
        localStorage.setItem('pomodoro_timer_set', 'true');
        localStorage.setItem('pomodoro_work_duration', state.workDuration);
      } else {
        localStorage.removeItem('pomodoro_timer_set');
        localStorage.removeItem('pomodoro_work_duration');
      }
      if (state.breakDuration !== null && !isNaN(state.breakDuration)) {
        localStorage.setItem('pomodoro_break_duration', state.breakDuration);
      }
    } catch (e) {
      console.warn('Could not save preferences to localStorage:', e);
    }
  }

  function loadStoredHistory() {
    try {
      const stored = localStorage.getItem('pomodoro_sessions');
      if (stored) {
        state.sessionsHistory = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Could not load sessions from localStorage:', e);
    }
    try {
      const storedLog = localStorage.getItem('pomodoro_daily_log');
      if (storedLog) {
        state.dailyLog = JSON.parse(storedLog);
      }
    } catch (e) {
      console.warn('Could not load daily log from localStorage:', e);
    }
    rebuildDailyLog();
  }

  function saveHistory() {
    try {
      localStorage.setItem('pomodoro_sessions', JSON.stringify(state.sessionsHistory));
    } catch (e) {
      console.warn('Could not save sessions to localStorage:', e);
    }
    try {
      localStorage.setItem('pomodoro_daily_log', JSON.stringify(state.dailyLog));
    } catch (e) {
      console.warn('Could not save daily log to localStorage:', e);
    }
  }

  let lastCheckedDayKey = null;

  function checkDayRollover() {
    const currentTodayKey = getDayKey(new Date());
    if (lastCheckedDayKey === null) {
      lastCheckedDayKey = currentTodayKey;
      return;
    }

    if (lastCheckedDayKey !== currentTodayKey) {
      lastCheckedDayKey = currentTodayKey;
      rebuildDailyLog();
      renderSummary();
    }
  }

  function rebuildDailyLog() {
    const currentTodayKey = getDayKey(new Date());
    const log = { ...state.dailyLog };

    // Calculate sum of sessions for each day currently present in sessionsHistory
    const sessionsByDay = {};
    const daysInHistory = new Set();

    state.sessionsHistory.forEach(s => {
      const dateObj = s.id ? new Date(s.id) : new Date();
      const dayKey = s.dayKey || getDayKey(dateObj);
      s.dayKey = dayKey; // Ensure dayKey is set on session object

      const totalSec = s.totalSec !== undefined ? s.totalSec : ((s.workSec || 0) + (s.otSec || 0));
      sessionsByDay[dayKey] = (sessionsByDay[dayKey] || 0) + totalSec;
      daysInHistory.add(dayKey);
    });

    // Authoritatively set the daily total for all days present in sessionsHistory
    daysInHistory.forEach(dayKey => {
      log[dayKey] = sessionsByDay[dayKey];
    });

    // Ensure today's entry reflects today's sessions sum (or 0 if none)
    log[currentTodayKey] = sessionsByDay[currentTodayKey] || 0;

    // Clean up empty or invalid entries for past days
    Object.keys(log).forEach(key => {
      if (key !== currentTodayKey && (!log[key] || log[key] <= 0)) {
        delete log[key];
      }
    });

    state.dailyLog = log;
    try {
      localStorage.setItem('pomodoro_daily_log', JSON.stringify(state.dailyLog));
    } catch (e) { }
  }

  function loadStoredTasks() {
    try {
      const stored = localStorage.getItem('pomodoro_tasks');
      if (stored) {
        state.tasks = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Could not load tasks from localStorage:', e);
    }
  }

  function saveTasks() {
    try {
      localStorage.setItem('pomodoro_tasks', JSON.stringify(state.tasks));
    } catch (e) {
      console.warn('Could not save tasks to localStorage:', e);
    }
  }

  // Tone Frequencies (Hz)
  const NOTES = {
    C5: 523.25,
    E5: 659.25,
    G5: 783.99,
    C6: 1046.50 // One octave higher than C5
  };

  // --- Web Audio Chime Generator ---
  function playBellChime(freq1 = NOTES.C5, freq2 = NOTES.E5) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      // Tone 1
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq1, ctx.currentTime);
      gain1.gain.setValueAtTime(0.3, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 1.2);

      // Tone 2
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq2, ctx.currentTime + 0.15);
      gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.15);
      osc2.stop(ctx.currentTime + 1.5);
    } catch (e) {
      console.warn('Web Audio error:', e);
    }
  }

  // --- Helper Formatting Functions ---
  function formatMMSS(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0) {
      seconds = 0;
    }
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatHHMM(dateObj) {
    const h = String(dateObj.getHours()).padStart(2, '0');
    const m = String(dateObj.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  // Study "day" runs 3:00 AM → 2:59 AM. Shift back 3 hours to get the correct date key.
  function getDayKey(dateObj) {
    if (!dateObj) dateObj = new Date();
    if (typeof dateObj === 'number' || typeof dateObj === 'string') {
      dateObj = new Date(dateObj);
    }
    const shifted = new Date(dateObj.getTime() - 3 * 60 * 60 * 1000);
    const y = shifted.getFullYear();
    const mo = String(shifted.getMonth() + 1).padStart(2, '0');
    const d = String(shifted.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }

  // Format a day key "YYYY-MM-DD" into a human-readable label like "Mon, Aug 11"
  function formatDayLabel(key) {
    // Parse as local date (append T12:00 to avoid timezone shift on date-only strings)
    const [y, mo, d] = key.split('-').map(Number);
    const date = new Date(y, mo - 1, d, 12, 0, 0);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // --- Core Timer Controller ---
  function startTimer() {
    if (state.timerState === 'running' || state.timerState === 'overtime') return;

    // If timer has not been set yet, prompt user to set study time first
    if (state.mode === 'work' && (!state.timerHasBeenSet || state.workDuration === null || isNaN(state.workDuration))) {
      openInlineTimeEditor(true);
      return;
    }

    // Immediate Overtime Mode if workDuration === 0
    if (state.mode === 'work' && state.workDuration === 0) {
      state.timerState = 'overtime';
      state.overtimeSeconds = 0;
      state.sessionStartTimestamp = formatHHMM(new Date());
      body.className = 'theme-ot';
      updateUI();

      clearInterval(state.timerInterval);
      state.timerInterval = setInterval(handleTick, 1000);
      return;
    }

    if (state.timerState === 'stopped') {
      if (state.mode === 'work') {
        state.remainingSeconds = state.workDuration;
        state.sessionStartTimestamp = formatHHMM(new Date());
      } else {
        state.remainingSeconds = state.breakDuration;
      }
    }

    state.timerState = 'running';
    updateUI();

    clearInterval(state.timerInterval);
    state.timerInterval = setInterval(handleTick, 1000);
  }

  function pauseTimer() {
    if (state.timerState !== 'running') return;
    clearInterval(state.timerInterval);
    state.timerState = 'paused';
    updateUI();
  }

  function cancelTimer() {
    clearInterval(state.timerInterval);

    // Record cancelled pomodoro session to history if time elapsed
    let elapsed = 0;
    if ((state.timerState === 'running' || state.timerState === 'paused') && state.mode === 'work') {
      elapsed = Math.max(0, (state.workDuration || 0) - state.remainingSeconds);
    } else if (state.timerState === 'overtime') {
      elapsed = (state.workDuration || 0) + (state.overtimeSeconds || 0);
    }

    if (elapsed > 0 && state.sessionStartTimestamp) {
      const now = new Date();
      const endTime = formatHHMM(now);
      const workSec = Math.min(elapsed, state.workDuration || 0);
      const otSec = state.timerState === 'overtime' ? (state.overtimeSeconds || 0) : 0;
      const dayKey = getDayKey(now);

      state.sessionsHistory.push({
        id: Date.now(),
        dayKey: dayKey,
        startTime: state.sessionStartTimestamp,
        endTime: endTime,
        workSec: workSec,
        otSec: otSec,
        totalSec: elapsed,
        cancelled: true
      });

      saveHistory();
      rebuildDailyLog();
    }

    state.timerState = 'stopped';
    state.overtimeSeconds = 0;
    state.sessionStartTimestamp = null;

    if (state.mode === 'work') {
      // Cancelling timer in Work mode automatically transitions to Break mode!
      state.mode = 'break';
      state.remainingSeconds = state.breakDuration;
      body.className = 'theme-break';
    } else {
      state.mode = 'work';
      state.remainingSeconds = (state.workDuration !== null && !isNaN(state.workDuration)) ? state.workDuration : 0;
      body.className = 'theme-work';
    }

    updateUI();
  }

  function handleTick() {
    checkDayRollover();
    if (state.timerState === 'running') {
      state.remainingSeconds--;

      if (state.remainingSeconds <= 0) {
        state.remainingSeconds = 0;
        onTimerComplete();
        return;
      }
    } else if (state.timerState === 'overtime') {
      state.overtimeSeconds++;
    }

    updateDisplayReadout();
    updatePageTitle();
  }

  function onTimerComplete() {
    if (state.mode === 'work') {
      playBellChime(NOTES.E5, NOTES.G5); // Work ends: E -> G

      if (state.overtimeEnabled) {
        // Transition to Overtime Mode!
        state.timerState = 'overtime';
        state.overtimeSeconds = 0;
        body.className = 'theme-ot';
        updateUI();
      } else {
        // OT off: log session & switch to break mode (stopped — user must press play)
        logCompletedSession();
        transitionToBreak(false);
      }
    } else {
      // Break Timer Finished -> Transition back to Work Mode
      playBellChime(NOTES.C5, NOTES.E5); // Break ends: C -> E
      transitionToWork();
    }
  }

  function finishOvertimeSession() {
    if (state.timerState !== 'overtime') return;
    playBellChime(NOTES.G5, NOTES.C6); // OT ends: G -> C (C6 is 1 octave higher than C5)
    clearInterval(state.timerInterval);
    logCompletedSession();
    transitionToBreak();
  }

  function logCompletedSession() {
    const now = new Date();
    const endTime = formatHHMM(now);
    const workSec = (state.workDuration !== null && !isNaN(state.workDuration)) ? state.workDuration : 0;
    const otSec = state.overtimeSeconds || 0;
    const totalSec = workSec + otSec;
    const startTime = state.sessionStartTimestamp || formatHHMM(new Date(now.getTime() - totalSec * 1000));
    const dayKey = getDayKey(now);

    state.sessionsHistory.push({
      id: Date.now(),
      dayKey: dayKey,
      startTime: startTime,
      endTime: endTime,
      workSec: workSec,
      otSec: otSec,
      totalSec: totalSec,
      cancelled: false
    });

    state.overtimeSeconds = 0;
    state.sessionStartTimestamp = null;
    saveHistory();
    rebuildDailyLog();
  }

  // autoStart = true  → break timer starts immediately (used when OT mode is on)
  // autoStart = false → break mode resets but stays stopped (used when OT mode is off)
  function transitionToBreak(autoStart = true) {
    state.mode = 'break';
    state.remainingSeconds = state.breakDuration;
    body.className = 'theme-break';
    clearInterval(state.timerInterval);

    if (autoStart) {
      state.timerState = 'running';
      state.timerInterval = setInterval(handleTick, 1000);
    } else {
      state.timerState = 'stopped';
    }
    updateUI();
  }

  function transitionToWork() {
    state.mode = 'work';
    body.className = 'theme-work';
    clearInterval(state.timerInterval);

    if (!state.timerHasBeenSet || state.workDuration === null || isNaN(state.workDuration)) {
      state.remainingSeconds = 0;
      state.timerState = 'stopped';
      updateUI();
      return;
    }

    state.remainingSeconds = state.workDuration;
    state.overtimeSeconds = 0;

    if (state.overtimeEnabled) {
      if (state.workDuration === 0) {
        state.timerState = 'overtime';
        state.overtimeSeconds = 0;
        state.sessionStartTimestamp = formatHHMM(new Date());
        body.className = 'theme-ot';
        state.timerInterval = setInterval(handleTick, 1000);
      } else {
        // OT on: auto-start the next work session after break ends
        state.timerState = 'running';
        state.sessionStartTimestamp = formatHHMM(new Date());
        state.timerInterval = setInterval(handleTick, 1000);
      }
    } else {
      // OT off: reset to stopped, user presses play to begin
      state.timerState = 'stopped';
    }
    updateUI();
  }

  function switchMode(newMode) {
    if (state.mode === newMode) return;

    // If leaving work mode while timer was running/paused with elapsed work time, preserve and log it!
    if (state.mode === 'work') {
      let elapsed = 0;
      if (state.timerState === 'overtime') {
        elapsed = (state.workDuration || 0) + (state.overtimeSeconds || 0);
      } else if (state.timerState === 'running' || state.timerState === 'paused') {
        elapsed = Math.max(0, (state.workDuration || 0) - state.remainingSeconds);
      }

      if (elapsed > 0 && state.sessionStartTimestamp) {
        const now = new Date();
        const endTime = formatHHMM(now);
        const workSec = Math.min(elapsed, state.workDuration || 0);
        const otSec = state.timerState === 'overtime' ? (state.overtimeSeconds || 0) : 0;
        const dayKey = getDayKey(now);

        state.sessionsHistory.push({
          id: Date.now(),
          dayKey: dayKey,
          startTime: state.sessionStartTimestamp,
          endTime: endTime,
          workSec: workSec,
          otSec: otSec,
          totalSec: elapsed,
          cancelled: true
        });

        saveHistory();
        rebuildDailyLog();
      }
    }

    clearInterval(state.timerInterval);

    state.mode = newMode;
    state.timerState = 'stopped';
    state.overtimeSeconds = 0;
    state.sessionStartTimestamp = null;

    if (newMode === 'work') {
      state.remainingSeconds = (state.workDuration !== null && !isNaN(state.workDuration)) ? state.workDuration : 0;
      body.className = 'theme-work';
    } else {
      state.remainingSeconds = state.breakDuration;
      body.className = 'theme-break';
    }

    updateUI();
  }

  // --- Inline Time Editing ---
  function openInlineTimeEditor(shake = false) {
    if (inlineTimeInput.style.display !== 'inline-block') {
      timerReadout.style.display = 'none';
      inlineTimeInput.style.display = 'inline-block';

      if (state.mode === 'break') {
        inlineTimeInput.value = Math.max(1, Math.floor(state.breakDuration / 60));
      } else if (state.timerHasBeenSet && state.workDuration !== null && !isNaN(state.workDuration)) {
        inlineTimeInput.value = Math.floor(state.workDuration / 60);
      } else {
        inlineTimeInput.value = '';
      }
    }
    inlineTimeInput.focus();
    if (inlineTimeInput.value) {
      inlineTimeInput.select();
    }
    if (shake && timerDisplayBox) {
      timerDisplayBox.classList.remove('prompt-attention');
      void timerDisplayBox.offsetWidth; // force DOM reflow
      timerDisplayBox.classList.add('prompt-attention');
    }
  }

  function saveInlineTime() {
    const val = inlineTimeInput.value.trim();
    if (val !== '') {
      const mins = parseInt(val, 10);
      // Allow 0 for work mode (triggers instant overtime), but break must be > 0
      const isValid = !isNaN(mins) && mins <= 360 && (state.mode === 'work' ? mins >= 0 : mins > 0);
      if (isValid) {
        if (state.mode === 'break') {
          state.breakDuration = mins * 60;
          savePreferences();
          // Apply the new duration immediately regardless of timer state
          state.remainingSeconds = state.breakDuration;
        } else {
          state.workDuration = mins * 60;
          state.timerHasBeenSet = true;
          savePreferences();
          // Apply the new duration immediately regardless of timer state
          if (state.mode === 'work') {
            state.remainingSeconds = state.workDuration;
          }
        }
      }
    }
    closeInlineTimeEditor();
  }

  function closeInlineTimeEditor() {
    inlineTimeInput.style.display = 'none';
    timerReadout.style.display = 'block';
    updateUI();
  }

  // --- Task Manager ---
  function addTask(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    state.tasks.unshift({
      id: Date.now(),
      text: trimmed,
      completed: false
    });

    saveTasks();
    renderTasks();
  }

  function toggleTaskComplete(id) {
    const task = state.tasks.find(t => t.id === id);
    if (task) {
      task.completed = !task.completed;
      saveTasks();
      renderTasks();
    }
  }

  function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveTasks();
    renderTasks();
  }

  let draggedTaskId = null;

  function renderTasks() {
    taskList.innerHTML = '';

    // Sort tasks: Active (uncompleted) first, Completed at the bottom
    const sortedTasks = [...state.tasks].sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1));

    sortedTasks.forEach(task => {
      const li = document.createElement('li');
      li.className = `task-item ${task.completed ? 'completed' : ''}`;
      li.setAttribute('data-id', task.id);
      li.setAttribute('draggable', 'true');

      li.innerHTML = `
        <div class="task-left">
          <span class="task-bullet">•</span>
          <span class="task-text" title="Double-click to edit">${escapeHTML(task.text)}</span>
        </div>
        <div class="task-actions">
          <button class="task-btn task-check-btn" title="Toggle Complete">✓</button>
          <button class="task-btn task-delete-btn" title="Delete Task">✕</button>
        </div>
      `;

      const taskTextEl = li.querySelector('.task-text');
      const checkBtn = li.querySelector('.task-check-btn');
      const deleteBtn = li.querySelector('.task-delete-btn');

      // Double-click to edit task text
      taskTextEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        editTaskText(task.id, taskTextEl);
      });

      // Drag and Drop Reordering Handlers
      li.addEventListener('dragstart', (e) => {
        draggedTaskId = task.id;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        draggedTaskId = null;
        document.querySelectorAll('.task-item').forEach(el => el.classList.remove('drag-over'));
      });

      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        li.classList.add('drag-over');
      });

      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over');
      });

      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        if (!draggedTaskId || draggedTaskId === task.id) return;

        const fromIndex = state.tasks.findIndex(t => t.id === draggedTaskId);
        const toIndex = state.tasks.findIndex(t => t.id === task.id);

        if (fromIndex !== -1 && toIndex !== -1) {
          const [movedTask] = state.tasks.splice(fromIndex, 1);
          state.tasks.splice(toIndex, 0, movedTask);
          saveTasks();
          renderTasks();
        }
      });

      checkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTaskComplete(task.id);
      });

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTask(task.id);
      });

      taskList.appendChild(li);
    });
  }

  function editTaskText(taskId, textSpan) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const editArea = document.createElement('textarea');
    editArea.className = 'task-edit-input';
    editArea.value = task.text;
    editArea.rows = 1;

    // Auto-resize to fit content without scroll
    function autoResize() {
      editArea.style.height = 'auto';
      editArea.style.height = editArea.scrollHeight + 'px';
    }

    textSpan.replaceWith(editArea);
    autoResize();
    editArea.focus();
    // Place cursor at end
    editArea.setSelectionRange(editArea.value.length, editArea.value.length);
    editArea.addEventListener('input', autoResize);

    let committed = false;
    function commitEdit() {
      if (committed) return;
      committed = true;
      const newText = editArea.value.trim();
      if (newText) {
        task.text = newText;
        saveTasks();
      }
      renderTasks();
    }

    editArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitEdit();
      } else if (e.key === 'Escape') {
        committed = true;
        renderTasks();
      }
    });

    editArea.addEventListener('blur', commitEdit);
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g,
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  // --- UI Renderer ---
  function updateUI() {
    // 1. Mode Tabs
    tabWork.classList.toggle('active', state.mode === 'work');
    tabBreak.classList.toggle('active', state.mode === 'break');

    // 2. Body Theme (if not in overtime)
    if (state.timerState === 'overtime') {
      body.className = 'theme-ot';
    } else if (state.mode === 'work') {
      body.className = 'theme-work';
    } else {
      body.className = 'theme-break';
    }

    // 3. Display Readout & OT Badge
    updateDisplayReadout();

    // 4. Overtime Checkbox
    overtimeCheckbox.checked = state.overtimeEnabled;

    // 5. Action Button Icons
    iconPlay.style.display = 'none';
    iconPause.style.display = 'none';
    iconCheck.style.display = 'none';

    if (state.timerState === 'overtime') {
      iconCheck.style.display = 'block';
      actionBtn.setAttribute('aria-label', 'Complete Session');
    } else if (state.timerState === 'running') {
      iconPause.style.display = 'block';
      actionBtn.setAttribute('aria-label', 'Pause Timer');
    } else {
      iconPlay.style.display = 'block';
      actionBtn.setAttribute('aria-label', 'Start Timer');
    }

    // 6. Title Update
    updatePageTitle();

    // 7. Render Task List
    renderTasks();

    // 8. Update Summary if open
    if (summaryPopover.style.display === 'block') {
      renderSummary();
    }
  }

  function updateDisplayReadout() {
    if (inlineTimeInput.style.display === 'inline-block') return;

    if (state.timerState === 'stopped') {
      if (state.mode === 'work' && (!state.timerHasBeenSet || state.workDuration === null || isNaN(state.workDuration))) {
        timerReadout.textContent = 'SET TIMER';
        timerReadout.classList.add('is-text');
        timerReadout.classList.remove('is-ot');
        cancelTimerBtn.style.display = 'none';
      } else if (state.mode === 'break') {
        timerReadout.textContent = formatMMSS(state.remainingSeconds || state.breakDuration);
        timerReadout.classList.remove('is-text');
        timerReadout.classList.remove('is-ot');
        cancelTimerBtn.style.display = 'block';
      } else {
        timerReadout.textContent = formatMMSS(state.remainingSeconds);
        timerReadout.classList.remove('is-text');
        timerReadout.classList.remove('is-ot');
        cancelTimerBtn.style.display = 'block';
      }
      otBadge.style.display = 'none';
    } else if (state.timerState === 'overtime') {
      timerReadout.innerHTML = `+${formatMMSS(state.overtimeSeconds)} <span class="ot-text">OT</span>`;
      timerReadout.classList.remove('is-text');
      timerReadout.classList.add('is-ot');
      cancelTimerBtn.style.display = 'block';
      otBadge.style.display = 'none';
    } else {
      timerReadout.textContent = formatMMSS(state.remainingSeconds);
      timerReadout.classList.remove('is-text');
      timerReadout.classList.remove('is-ot');
      cancelTimerBtn.style.display = 'block';
      otBadge.style.display = 'none';
    }
  }

  function updatePageTitle() {
    let modeLabel = state.mode === 'work' ? 'Work' : 'Break';
    if (state.timerState === 'overtime') {
      document.title = `(+${formatMMSS(state.overtimeSeconds)}) OT - Study Pomodoro Timer`;
    } else if (state.timerState === 'stopped') {
      document.title = `Study Timer - Free Online Pomodoro & Focus Timer with Overtime`;
    } else {
      document.title = `(${formatMMSS(state.remainingSeconds)}) ${modeLabel} - Study Timer`;
    }
  }

  // --- Summary & Analytics Popover Renderer ---
  function renderSummary() {
    checkDayRollover();
    rebuildDailyLog();

    // Total Work Time Calculation for the current day
    const currentTodayKey = getDayKey(new Date());
    const totalWorkSec = state.dailyLog[currentTodayKey] || 0;

    const hrs = Math.floor(totalWorkSec / 3600);
    const mins = Math.floor((totalWorkSec % 3600) / 60);
    statTotalTime.textContent = `${String(hrs).padStart(2, '0')} hrs ${String(mins).padStart(2, '0')} mins`;

    const todaySessionsCount = state.sessionsHistory.filter(s => {
      const dayKey = s.dayKey || getDayKey(s.id ? new Date(s.id) : new Date());
      return dayKey === currentTodayKey;
    }).length;
    statSessionCount.textContent = String(todaySessionsCount).padStart(2, '0');

    // --- Tab switching ---
    const isSessionsTab = state.summaryTab === 'sessions';
    if (summaryTabSessions) summaryTabSessions.classList.toggle('active', isSessionsTab);
    if (summaryTabDaily) summaryTabDaily.classList.toggle('active', !isSessionsTab);
    if (sessionsPanel) sessionsPanel.style.display = isSessionsTab ? '' : 'none';
    if (dailyPanel) dailyPanel.style.display = isSessionsTab ? 'none' : '';

    if (isSessionsTab) {
      renderSessionsPanel();
    } else {
      renderDailyLogPanel();
    }
  }

  function renderSessionsPanel() {
    // Grid population
    sessionsGrid.innerHTML = '';
    const sessionsTip = document.getElementById('sessionsTip');
    const currentTodayKey = getDayKey(new Date());

    // Only display today's sessions on the Sessions panel
    const todaySessionsWithIndex = [];
    state.sessionsHistory.forEach((session, index) => {
      const dayKey = session.dayKey || getDayKey(session.id ? new Date(session.id) : new Date());
      if (dayKey === currentTodayKey) {
        todaySessionsWithIndex.push({ session, index });
      }
    });

    const totalItems = todaySessionsWithIndex.length;

    if (totalItems === 0) {
      sessionsGrid.innerHTML = `<div class="no-sessions">No completed sessions yet</div>`;
      if (sessionsTip) sessionsTip.style.display = 'none';
      return;
    }

    if (sessionsTip) sessionsTip.style.display = 'block';

    todaySessionsWithIndex.forEach(({ session, index: absoluteIndex }) => {
      const totalSec = session.totalSec !== undefined ? session.totalSec : ((session.workSec || 0) + (session.otSec || 0));
      const totalDurMin = Math.round(totalSec / 60);
      const cancelTag = session.cancelled ? ' (cancelled)' : '';

      const itemEl = document.createElement('div');
      itemEl.className = 'session-item';
      itemEl.innerHTML = `
        <span class="session-time">${session.startTime} ~ ${session.endTime}</span>
        <span class="session-dur">${totalDurMin}m${cancelTag}</span>
      `;

      itemEl.title = 'Swipe left or double-click to edit';
      itemEl.addEventListener('dblclick', () => editSession(absoluteIndex, itemEl, session));

      // Swipe left interaction: drags item left, then activates editing on release
      let touchStartX = 0;
      let touchStartY = 0;
      let touchLastX = 0;
      let isDragging = false;
      let dirLocked = false;
      let isHoriz = false;

      itemEl.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1 || itemEl.classList.contains('editing')) return;
        touchStartX = touchLastX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isDragging = true;
        dirLocked = false;
        isHoriz = false;
        itemEl.style.transition = 'none';
      }, { passive: true });

      itemEl.addEventListener('touchmove', (e) => {
        if (!isDragging || e.touches.length !== 1) return;
        touchLastX = e.touches[0].clientX;
        const dx = touchLastX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;

        if (!dirLocked) {
          if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            isHoriz = Math.abs(dx) > Math.abs(dy);
            dirLocked = true;
          }
        }

        if (!isHoriz) return;

        // Prevent vertical scrolling or popover drag while swiping horizontally
        e.preventDefault();
        e.stopPropagation();

        // Slide left only (negative translation), capped at max 60px
        if (dx <= 0) {
          const clamped = Math.max(-60, dx);
          itemEl.style.transform = `translateX(${clamped}px)`;
        } else {
          itemEl.style.transform = 'translateX(0)';
        }
      }, { passive: false });

      itemEl.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;

        if (!isHoriz) {
          itemEl.style.transition = 'transform 0.18s ease-out';
          itemEl.style.transform = 'translateX(0)';
          return;
        }

        const dx = (e.changedTouches && e.changedTouches.length > 0)
          ? e.changedTouches[0].clientX - touchStartX
          : touchLastX - touchStartX;

        // Animate sliding back to original position
        itemEl.style.transition = 'transform 0.18s ease-out';
        itemEl.style.transform = 'translateX(0)';

        // If swiped left (at least 20px), activate editing after the slide-back animation finishes
        if (dx <= -20) {
          setTimeout(() => {
            if (itemEl.isConnected && !itemEl.classList.contains('editing')) {
              itemEl.style.transform = '';
              itemEl.style.transition = '';
              editSession(absoluteIndex, itemEl, session);
            }
          }, 180);
        }
      });

      itemEl.addEventListener('touchcancel', () => {
        isDragging = false;
        itemEl.style.transition = 'transform 0.18s ease-out';
        itemEl.style.transform = 'translateX(0)';
      });

      sessionsGrid.appendChild(itemEl);
    });
  }

  function renderDailyLogPanel() {
    if (!dailyLogGrid) return;
    dailyLogGrid.innerHTML = '';

    const currentTodayKey = getDayKey(new Date());

    // Include all study days with work time > 0, sorted descending by date (most recent first)
    const entries = Object.entries(state.dailyLog)
      .filter(([key, secs]) => secs > 0)
      .sort((a, b) => b[0].localeCompare(a[0]));

    if (entries.length === 0) {
      dailyLogGrid.innerHTML = `<div class="no-sessions">No completed study days recorded yet</div>`;
      return;
    }

    entries.forEach(([key, secs]) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'daily-log-item';

      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      let timeStr;
      if (h > 0) {
        timeStr = `${h}h ${String(m).padStart(2, '0')}m`;
      } else if (m > 0) {
        timeStr = `${m}m`;
      } else if (secs > 0) {
        timeStr = '< 1m';
      } else {
        timeStr = '0m';
      }

      const isToday = key === currentTodayKey;
      const todayBadgeHtml = isToday ? '<span class="daily-today-badge">TODAY</span>' : '';

      itemEl.innerHTML = `
        <span class="daily-log-date">${formatDayLabel(key)} ${todayBadgeHtml}</span>
        <span class="daily-log-time">${timeStr}</span>
      `;
      dailyLogGrid.appendChild(itemEl);
    });
  }

  // --- Session Inline Editor ---
  function editSession(sessionIndex, itemEl, session) {
    const otSec = session.otSec || 0;
    const totalSec = session.totalSec !== undefined ? session.totalSec : ((session.workSec || 0) + otSec);
    const totalDurMin = Math.round(totalSec / 60);
    itemEl.classList.add('editing');
    itemEl.innerHTML = `
      <div class="session-edit-row">
        <input type="text" class="session-edit-input" data-field="start" value="${session.startTime}" placeholder="HH:MM" maxlength="5">
        <span class="session-edit-sep">~</span>
        <input type="text" class="session-edit-input" data-field="end" value="${session.endTime}" placeholder="HH:MM" maxlength="5">
        <input type="number" class="session-edit-input session-edit-dur" data-field="dur" value="${totalDurMin}" min="1" max="999" title="Total duration in minutes">
        <span class="session-edit-unit">m</span>
        <button type="button" class="session-delete-btn" title="Remove session" aria-label="Remove session">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      </div>
    `;

    const deleteBtn = itemEl.querySelector('.session-delete-btn');
    let committed = false;

    deleteBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      committed = true;
    });

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      committed = true;
      removeSession(sessionIndex);
    });

    const inputs = itemEl.querySelectorAll('.session-edit-input');
    inputs[0].focus();
    inputs[0].select();

    function commitSessionEdit() {
      if (committed) return;
      committed = true;
      const newStart = inputs[0].value.trim() || session.startTime;
      const newEnd = inputs[1].value.trim() || session.endTime;
      const newDurMin = parseInt(inputs[2].value, 10);
      const newTotalSec = (!isNaN(newDurMin) && newDurMin > 0) ? newDurMin * 60 : totalSec;
      const newOtSec = Math.min(otSec, newTotalSec);
      const newWorkSec = newTotalSec - newOtSec;

      state.sessionsHistory[sessionIndex] = {
        ...session,
        startTime: newStart,
        endTime: newEnd,
        totalSec: newTotalSec,
        workSec: newWorkSec,
        otSec: newOtSec
      };
      saveHistory();
      rebuildDailyLog();
      renderSummary();
    }

    inputs.forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commitSessionEdit();
        if (e.key === 'Escape') { committed = true; renderSummary(); }
      });
      input.addEventListener('blur', () => {
        // Wait to see if focus moved to another input or button inside the same editor
        setTimeout(() => {
          if (!itemEl.contains(document.activeElement)) {
            commitSessionEdit();
          }
        }, 150);
      });
    });
  }

  function removeSession(sessionIndex) {
    state.sessionsHistory.splice(sessionIndex, 1);
    saveHistory();
    rebuildDailyLog();
    renderSummary();
  }

  // --- Event Listeners ---
  function attachEventListeners() {
    // Mode Switcher Tabs
    tabWork.addEventListener('click', () => switchMode('work'));
    tabBreak.addEventListener('click', () => switchMode('break'));

    // Inline Time Editing on Display Box Click
    timerDisplayBox.addEventListener('click', (e) => {
      if (cancelTimerBtn.contains(e.target)) return; // Don't trigger when clicking cancel square
      if (state.timerState !== 'overtime') {
        openInlineTimeEditor();
      }
    });

    inlineTimeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveInlineTime();
      } else if (e.key === 'Escape') {
        closeInlineTimeEditor();
      }
    });

    inlineTimeInput.addEventListener('blur', () => {
      saveInlineTime();
    });

    // Square Cancel Timer Button (C8CFB4) at bottom right of SET TIMER display box
    cancelTimerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelTimer();
    });

    // Overtime Checkbox Toggle
    overtimeCheckbox.addEventListener('change', (e) => {
      state.overtimeEnabled = e.target.checked;
    });

    // Action Circle Button (Play / Pause / Checkmark)
    actionBtn.addEventListener('click', () => {
      if (state.timerState === 'overtime') {
        finishOvertimeSession();
      } else if (state.timerState === 'running') {
        pauseTimer();
      } else {
        startTimer();
      }
    });

    function updateTaskSubmitBtnVisibility() {
      if (taskSubmitBtn) {
        taskSubmitBtn.style.display = taskInput.value.trim() !== '' ? 'block' : 'none';
      }
    }

    // Task Input (Press Enter or Click Arrow to Add Task)
    taskInput.addEventListener('input', updateTaskSubmitBtnVisibility);

    taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTask(taskInput.value);
        taskInput.value = '';
        updateTaskSubmitBtnVisibility();
      }
    });

    if (taskSubmitBtn) {
      taskSubmitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addTask(taskInput.value);
        taskInput.value = '';
        updateTaskSubmitBtnVisibility();
        taskInput.focus();
      });
    }

    // Analytics Button & Summary Popover
    analyticsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = summaryPopover.style.display === 'block';
      summaryPopover.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        state.currentPage = Math.max(1, Math.ceil(state.sessionsHistory.length / state.pageSize));
        renderSummary();
      }
    });

    document.addEventListener('click', (e) => {
      if (summaryPopover.style.display === 'block' &&
        !summaryPopover.contains(e.target) &&
        !analyticsBtn.contains(e.target)) {
        summaryPopover.style.display = 'none';
      }
    });

    // Close Summary Button
    if (summaryCloseBtn) {
      summaryCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        summaryPopover.style.display = 'none';
      });
    }

    // Swipe down gesture to close summary popover on mobile / touch
    let startY = 0;
    let startX = 0;
    let currentY = 0;
    let isSwiping = false;

    summaryPopover.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        isSwiping = false;
      }
    }, { passive: true });

    function getActiveScrollableGrid() {
      return state.summaryTab === 'sessions' ? sessionsGrid : dailyLogGrid;
    }

    summaryPopover.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const diffY = currentY - startY;
      const diffX = currentX - startX;
      const grid = getActiveScrollableGrid();
      const isAtTop = summaryPopover.scrollTop <= 0 && (!grid || grid.scrollTop <= 0);

      if (Math.abs(diffY) > Math.abs(diffX)) {
        if (diffY > 0 && isAtTop) {
          // Downward drag at top: slide summary sheet down to close
          isSwiping = true;
          e.preventDefault();
          summaryPopover.style.transition = 'none';
          summaryPopover.style.transform = `translateY(${diffY}px)`;
        } else if (diffY < 0) {
          // Upward swipe: summary sheet stays completely in place (does nothing to modal or background)
          summaryPopover.style.transform = '';
          const isAtBottom = grid ? (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 1) : true;
          if (isAtBottom) {
            e.preventDefault(); // Prevent background body overscroll
          }
        }
      }
    }, { passive: false });

    function handleTouchEnd() {
      if (!isSwiping) return;
      const diffY = currentY - startY;
      isSwiping = false;

      summaryPopover.style.transition = 'transform 0.2s ease-out';
      if (diffY > 70) {
        summaryPopover.style.transform = 'translateY(100%)';
        setTimeout(() => {
          summaryPopover.style.display = 'none';
          summaryPopover.style.transform = '';
          summaryPopover.style.transition = '';
        }, 200);
      } else {
        summaryPopover.style.transform = '';
        setTimeout(() => {
          summaryPopover.style.transition = '';
        }, 200);
      }
      startY = 0;
      startX = 0;
      currentY = 0;
    }

    summaryPopover.addEventListener('touchend', handleTouchEnd);
    summaryPopover.addEventListener('touchcancel', handleTouchEnd);

    // Summary inner tab switching
    if (summaryTabSessions) {
      summaryTabSessions.addEventListener('click', () => {
        state.summaryTab = 'sessions';
        renderSummary();
      });
    }
    if (summaryTabDaily) {
      summaryTabDaily.addEventListener('click', () => {
        state.summaryTab = 'daily';
        renderSummary();
      });
    }

    // Clear Today's Sessions Button (on Sessions tab)
    const clearTodayBtn = document.getElementById('clearTodayBtn');
    if (clearTodayBtn) {
      clearTodayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm("Are you sure you want to clear today's sessions?")) {
          const todayKey = getDayKey(new Date());
          state.sessionsHistory = state.sessionsHistory.filter(s => {
            const dayKey = s.dayKey || getDayKey(s.id ? new Date(s.id) : new Date());
            return dayKey !== todayKey;
          });
          state.dailyLog[todayKey] = 0;
          saveHistory();
          rebuildDailyLog();
          renderSummary();
        }
      });
    }

    // Reset Statistics Button
    const resetStatsBtn = document.getElementById('resetStatsBtn');
    if (resetStatsBtn) {
      resetStatsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to reset all session statistics?')) {
          state.sessionsHistory = [];
          state.currentPage = 1;
          state.dailyLog = {};
          try {
            localStorage.removeItem('pomodoro_sessions');
            localStorage.removeItem('pomodoro_daily_log');
          } catch (err) { }
          renderSummary();
        }
      });
    }
  }

  // --- Run Initialization on DOM Ready ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
