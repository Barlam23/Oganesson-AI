/* Oganesson AI front end.
 *
 * Everything the model sees is built in buildSystemPrompt() and buildRequestMessages().
 * Character descriptions (character.desc) are for the user only and never go into those functions.
 */

const DEFAULT_API_URL = "http://localhost:1234/v1/chat/completions";
const DEFAULT_OLLAMA_URL = "http://localhost:11434/v1/chat/completions";
const DEFAULT_HUE = 268;

// Where each avatar picker lives in the page.
const AVATAR_FIELDS = {
    character: { preview: 'preview-avatar', hidden: 'bot-avatar-base64', remove: 'btn-remove-avatar', name: 'bot-name' },
    user: { preview: 'user-preview-avatar', hidden: 'user-avatar-base64', remove: 'btn-remove-user-avatar', name: 'user-name-input' }
};

const LOGO_URL = '/img/logo.png';

// Reasoning tokens count against max_tokens too. When thinking is on, this extra room keeps a short reply
// from being cut off (or left empty) because the model spent its budget on thinking.
const REASONING_TOKEN_HEADROOM = 2048;

// Chat memory: how many estimated tokens of conversation (plus the system prompt) are sent with each request.
// The oldest turns are dropped first; the system prompt and the newest message are always sent.
const DEFAULT_CONTEXT_TOKENS = 2048;
const CONTEXT_TOKEN_RANGE = { min: 1024, max: 8192, step: 512 };
// Room kept for the reply itself: the longest reply preset (novel, 6144) plus the reasoning headroom (2048).
const REPLY_TOKEN_RESERVE = 8192;

// Rough token estimate. Three characters per token is deliberately pessimistic, so non-English text fits too.
function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 3);
}

// Reply-length presets. The instructions do the real work; maxTokens is only a safety net so a reply can never run away.
const DEFAULT_LENGTH = 'medium';
const RESPONSE_LENGTHS = {
    short: {
        label: 'short',
        hint: 'One brief paragraph of 2 to 4 sentences (about 40 to 80 words).',
        rule: 'Keep the reply SHORT: one brief paragraph of 2–4 sentences. Focus on the single most important action or line of dialogue. Do not pad or list structure.',
        brief: 'one brief paragraph of 2–4 sentences',
        maxTokens: 1024
    },
    medium: {
        label: 'medium',
        hint: 'Two to three paragraphs (about 100 to 200 words).',
        rule: 'Keep the reply MEDIUM: about 2–3 paragraphs. Mix action and dialogue naturally. Do not pad or outline paragraph counts.',
        brief: '2–3 paragraphs',
        maxTokens: 2048
    },
    long: {
        label: 'long',
        hint: 'Four to six detailed paragraphs (about 300 to 500 words).',
        rule: 'Write a LONG, immersive reply: several detailed paragraphs. Describe setting, body language, and inner thoughts when it helps the scene. Do not outline or number paragraphs in advance; just write the scene.',
        brief: 'several detailed paragraphs',
        maxTokens: 4096
    },
    novel: {
        label: 'novel',
        hint: 'A long, novel-style passage of many paragraphs (about 700 to 1,000 words).',
        rule: 'Write a NOVEL-LENGTH reply: a long, richly developed passage of many paragraphs, with the pacing of a chapter. Expand on setting, atmosphere, body language, inner thoughts and dialogue. Do not outline or number paragraphs; just write the scene in full.',
        brief: 'a long, novel-style passage of many paragraphs',
        maxTokens: 6144
    }
};

const ICON = {
    copy: '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"></path></svg>',
    edit: '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>',
    trash: '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>',
    trashLg: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>',
    check: '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>',
    close: '<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>',
    plus: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg>'
};

const app = {
    defaultApiUrl: DEFAULT_API_URL,
    defaultServerError: "LM Studio server is not running!",
    data: {
        bots: [],
        settings: { provider: 'lmstudio', lmStudioUrl: DEFAULT_API_URL, lmStudioModel: '', ollamaUrl: DEFAULT_OLLAMA_URL, ollamaModel: '', contextTokens: DEFAULT_CONTEXT_TOKENS },
        userProfile: { name: "User", desc: "", gender: "", pronouns: "", avatar: "" },
        personas: [],
        activePersonaId: null
    },
    currentBotId: null,
    modalBotId: null,
    chatActionPanel: 'menu',
    isGenerating: false,
    abortController: null,
    notificationInterval: null,
    notificationStartTime: null,
    dataLoaded: false,
    saveLoop: null,
    saveQueued: false,
    lastSaveOk: true,
    strictRoleMode: false,
    draftGreetings: [""],
    activeGreeting: 0,
    notificationHideTimeout: null,
    notificationDuration: 10000,
    notificationLimit: 0,
    regenPending: false,
    editingMessage: null,
    confirmOpen: false,
    confirmToken: 0,
    searchTimer: null,
    arrowFrame: 0,
    draftLength: DEFAULT_LENGTH,
    draftThinking: true,
    draftProvider: 'lmstudio',
    providerDrafts: null,
    draftContext: DEFAULT_CONTEXT_TOKENS,
    chatEpochs: new WeakMap(),
    overviewGreetingIndex: 0,
    pendingGreeting: null,
    notificationHovered: false,

    /* ============================== startup ============================== */

    // Closing the page closes the app. The server waits a few seconds before stopping, so a reload or another
    // open tab can cancel the stop. Saves are written as each change happens, so nothing is lost.
    bindPageLifecycle() {
        const presence = typeof BroadcastChannel === 'function' ? new BroadcastChannel('oganesson-presence') : null;
        if (presence) {
            // Another tab is closing: this tab is still here, so tell the server to keep running.
            presence.onmessage = () => fetch('/api/alive', { method: 'POST' }).catch(() => {});
        }
        window.addEventListener('pagehide', (event) => {
            if (event.persisted) return;   // the page may come back from the back/forward cache
            if (presence) presence.postMessage('closing');
            navigator.sendBeacon('/api/closing');
        });
    },

    async init() {
        this.bindPageLifecycle();
        document.addEventListener('input', (event) => {
            if (event.target instanceof HTMLTextAreaElement && event.target.hasAttribute('data-autogrow')) {
                this.autoGrow(event.target);
            }
        });
        let resizeQueued = false;
        window.addEventListener('resize', () => {
            if (resizeQueued) return;
            resizeQueued = true;
            requestAnimationFrame(() => { resizeQueued = false; this.autoGrowAll(); this.updateGreetingArrows(); });
        });
        this.bindRipple();
        this.applyBranding();
        this.bindStaticEvents();
        await this.loadApplicationData();
        this.navigateToView('home');
        this.checkServerStatus();
    },

    // Material-style ripple under the pointer for .md-btn / .md-icon-btn.
    bindRipple() {
        document.addEventListener('pointerdown', (event) => {
            const button = event.target.closest('.md-btn, .md-icon-btn, .md-seg');
            if (!button || button.disabled) return;
            const box = button.getBoundingClientRect();
            const size = Math.max(box.width, box.height) * 2;
            const ripple = document.createElement('span');
            ripple.className = 'md-ripple';
            ripple.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - box.left - size / 2}px;top:${event.clientY - box.top - size / 2}px`;
            button.appendChild(ripple);
            ripple.addEventListener('animationend', () => ripple.remove());
        }, { passive: true });
    },

    // If static/img/logo.png exists it replaces the "O" tile in the header and is used as the browser-tab icon.
    applyBranding() {
        const probe = new Image();
        probe.onload = () => {
            const logo = document.getElementById('brand-logo');
            const fallback = document.getElementById('brand-fallback');
            const favicon = document.getElementById('app-favicon');
            if (logo) {
                logo.src = LOGO_URL;
                logo.classList.remove('hidden');
            }
            if (fallback && fallback.parentElement) fallback.parentElement.classList.add('hidden');
            if (favicon) favicon.href = LOGO_URL;
        };
        probe.src = LOGO_URL;
    },

    bindStaticEvents() {
        document.getElementById('bot-name').addEventListener('input', () => this.refreshCharacterAvatarPreview());

        document.getElementById('bot-firstmsg').addEventListener('input', (event) => {
            this.draftGreetings[this.activeGreeting] = event.target.value;
        });

        document.getElementById('greeting-tabs').addEventListener('click', (event) => this.handleGreetingTabClick(event));
        document.getElementById('btn-add-greeting').addEventListener('click', () => this.addGreetingTab());
        const greetingBody = document.querySelector('#view-create .greetings-wrapper .gbody');
        if (greetingBody) {
            greetingBody.addEventListener('click', (event) => {
                if (event.target.tagName !== 'TEXTAREA') this.focusGreetingEditor();
            });
        }
        const greetingTabsRow = document.querySelector('#view-create .greetings-wrapper .gtabs-row');
        if (greetingTabsRow) {
            greetingTabsRow.addEventListener('click', (event) => {
                if (event.target === event.currentTarget || event.target.id === 'greeting-tabs') this.focusGreetingEditor();
            });
        }

        const providerBubbles = document.getElementById('provider-bubbles');
        providerBubbles.addEventListener('click', (event) => {
            const bubble = event.target.closest('[data-provider]');
            if (bubble) this.selectProviderTab(bubble.dataset.provider);
        });
        document.getElementById('setting-api-url').addEventListener('input', () => this.syncProviderDraftFromFields());
        document.getElementById('setting-model').addEventListener('input', () => this.syncProviderDraftFromFields());

        const lengthGroup = document.getElementById('setting-length');
        lengthGroup.addEventListener('click', (event) => {
            const option = event.target.closest('[data-length]');
            if (option) this.renderLengthSetting(option.dataset.length);
        });
        lengthGroup.addEventListener('keydown', (event) => {   // arrow keys move through the options, like a radio group
            const keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
            if (!(event.key in keys)) return;
            event.preventDefault();
            const order = Object.keys(RESPONSE_LENGTHS);
            const next = order[(order.indexOf(this.draftLength) + keys[event.key] + order.length) % order.length];
            this.renderLengthSetting(next);
            lengthGroup.querySelector(`[data-length="${next}"]`).focus();
        });

        const thinkingSwitch = document.getElementById('setting-thinking');
        thinkingSwitch.addEventListener('click', () => this.renderThinkingSetting(!this.draftThinking));

        const contextSlider = document.getElementById('setting-context');
        const contextWrap = document.getElementById('setting-context-wrap');
        contextSlider.addEventListener('input', () => this.updateContextReadout());
        contextSlider.addEventListener('pointerdown', () => contextWrap.classList.add('is-dragging'));
        const endContextDrag = () => contextWrap.classList.remove('is-dragging');
        window.addEventListener('pointerup', endContextDrag);
        window.addEventListener('pointercancel', endContextDrag);

        const picker = document.getElementById('greeting-picker');
        picker.addEventListener('click', (event) => {
            const arrow = event.target.closest('[data-gp]');
            if (arrow) {
                this.scrollGreetings(arrow.dataset.gp === 'next' ? 1 : -1);
                return;
            }
            const option = event.target.closest('[data-greeting]');
            if (option) this.chooseGreeting(Number(option.dataset.greeting));
        });
        picker.addEventListener('keydown', (event) => {   // Left/Right move between the greetings
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            const card = event.target.closest('[data-greeting]');
            const next = card && (event.key === 'ArrowRight' ? card.nextElementSibling : card.previousElementSibling);
            if (next && next.matches('[data-greeting]')) {
                event.preventDefault();
                next.focus();
            }
        });

        document.getElementById('chat-messages').addEventListener('click', (event) => this.handleMessageAction(event));

        const overviewSections = document.getElementById('overview-sections');
        if (overviewSections) {
            overviewSections.addEventListener('click', (event) => {
                const toggle = event.target.closest('[data-overview-toggle]');
                if (toggle) this.toggleOverviewSection(toggle);
            });
        }

        document.getElementById('modal-chats').addEventListener('click', (event) => {
            if (event.target.id === 'modal-chats') this.closeChatSessionsModal();
        });

        const chatActionModal = document.getElementById('chat-action-modal');
        if (chatActionModal) {
            chatActionModal.addEventListener('click', (event) => {
                if (event.target.id === 'chat-action-modal' || event.target.id === 'chat-action-cancel') {
                    this.closeChatActionModal();
                    return;
                }
                const actionBtn = event.target.closest('[data-chat-action]');
                if (!actionBtn) return;
                const action = actionBtn.getAttribute('data-chat-action');
                if (action === 'new') {
                    this.closeChatActionModal();
                    this.createChatSession(this.currentBotId);
                } else if (action === 'resume') {
                    this.showChatActionPanel('resume');
                } else if (action === 'persona') {
                    this.showChatActionPanel('persona');
                } else if (action === 'back') {
                    this.showChatActionPanel('menu');
                }
            });
        }

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (!document.getElementById('confirm-modal').classList.contains('hidden')) return;
            if (chatActionModal && !chatActionModal.classList.contains('hidden')) {
                if (this.chatActionPanel !== 'menu') this.showChatActionPanel('menu');
                else this.closeChatActionModal();
                return;
            }
            if (!document.getElementById('modal-chats').classList.contains('hidden')) {
                this.closeChatSessionsModal();
            }
        });

        const notification = document.getElementById('error-notification');
        notification.addEventListener('mouseenter', () => this.pauseNotificationTimer());
        notification.addEventListener('mouseleave', () => this.resumeNotificationTimer());
    },

    // The saved provider decides the server, its endpoint, and its model name.
    providerConfig() {
        const s = this.data.settings;
        if (s.provider === 'ollama') {
            return { label: 'Ollama', url: (s.ollamaUrl || '').trim() || DEFAULT_OLLAMA_URL, model: (s.ollamaModel || '').trim() };
        }
        return { label: 'LM Studio', url: (s.lmStudioUrl || '').trim() || this.defaultApiUrl, model: (s.lmStudioModel || '').trim() };
    },

    currentEndpoint() {
        return this.providerConfig().url;
    },

    currentModel() {
        return this.providerConfig().model;
    },

    async checkServerStatus() {
        if (!this.dataLoaded) return;
        try {
            await fetch(this.currentEndpoint(), { method: 'HEAD', signal: AbortSignal.timeout(3000) });
        } catch (error) {
            this.showErrorNotification(`${this.serverName()} server is not running!`);
        }
    },

    serverName() {
        return this.providerConfig().label;
    },

    /* ============================ notification ============================ */

    showErrorNotification(message) {
        this.showNotification(message, 'error');
    },

    showSuccessNotification(message) {
        this.showNotification(message, 'success');
    },

    // Same toast for both: red for problems, green for confirmations (which close sooner).
    showNotification(message, type = 'error') {
        const notification = document.getElementById('error-notification');
        if (!notification) return;
        document.getElementById('error-notification-text').textContent = message || this.defaultServerError;
        notification.dataset.type = type;
        this.notificationLimit = type === 'success' ? Math.min(4000, this.notificationDuration) : this.notificationDuration;

        // A pending "hide" from an earlier dismissal must not hide this new message.
        if (this.notificationHideTimeout) {
            clearTimeout(this.notificationHideTimeout);
            this.notificationHideTimeout = null;
        }

        const alreadyShowing = !notification.classList.contains('hidden') && !notification.classList.contains('animate-notification-up');
        if (!alreadyShowing) {
            this.notificationHovered = false;
            notification.classList.remove('hidden', 'animate-notification-up');
            notification.classList.add('animate-notification-down');
        }
        this.startNotificationTimer();
    },

    startNotificationTimer() {
        this.clearNotificationTimers();
        const progressBar = document.getElementById('notification-progress-bar');
        if (this.notificationHovered) {              // stay open while the pointer is on it
            progressBar.style.width = '100%';
            return;
        }
        const totalDuration = this.notificationLimit || this.notificationDuration;
        this.notificationStartTime = Date.now();
        this.notificationInterval = setInterval(() => {
            const remaining = Math.max(0, totalDuration - (Date.now() - this.notificationStartTime));
            progressBar.style.width = (remaining / totalDuration * 100) + '%';
            if (remaining <= 0) this.dismissNotification();
        }, 50);
    },

    pauseNotificationTimer() {
        this.notificationHovered = true;
        this.clearNotificationTimers();
        document.getElementById('notification-progress-bar').style.width = '100%';
    },

    resumeNotificationTimer() {
        this.notificationHovered = false;
        const notification = document.getElementById('error-notification');
        if (notification && !notification.classList.contains('hidden')) this.startNotificationTimer();
    },

    clearNotificationTimers() {
        if (this.notificationInterval) {
            clearInterval(this.notificationInterval);
            this.notificationInterval = null;
        }
    },

    dismissNotification() {
        this.clearNotificationTimers();
        this.notificationHovered = false;
        const notification = document.getElementById('error-notification');
        if (!notification || notification.classList.contains('hidden')) return;

        notification.classList.remove('animate-notification-down');
        notification.classList.add('animate-notification-up');
        if (this.notificationHideTimeout) clearTimeout(this.notificationHideTimeout);
        this.notificationHideTimeout = setTimeout(() => {
            notification.classList.add('hidden');
            notification.classList.remove('animate-notification-up');
            this.notificationHideTimeout = null;
        }, 350);
    },

    /* ============================ data loading ============================ */

    async loadApplicationData() {
        this.dataLoaded = false;
        try {
            const response = await fetch('/api/data', { cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const loaded = await response.json();
            if (!loaded || typeof loaded !== 'object' || !Array.isArray(loaded.bots)) {
                throw new Error('Unexpected data format');
            }

            this.data = loaded;
            const rawSettings = loaded.settings || {};
            this.data.settings = Object.assign({ provider: 'lmstudio', lmStudioUrl: this.defaultApiUrl, lmStudioModel: '', ollamaUrl: DEFAULT_OLLAMA_URL, ollamaModel: '', responseLength: DEFAULT_LENGTH, thinking: true, contextTokens: DEFAULT_CONTEXT_TOKENS }, rawSettings);
            if (!('provider' in rawSettings)) this.migrateLegacySettings(this.data.settings, rawSettings);
            delete this.data.settings.model;   // older single model name, now kept per server
            if (this.data.settings.provider !== 'ollama') this.data.settings.provider = 'lmstudio';
            if (!(this.data.settings.lmStudioUrl || '').trim()) this.data.settings.lmStudioUrl = this.defaultApiUrl;
            if (!(this.data.settings.ollamaUrl || '').trim()) this.data.settings.ollamaUrl = DEFAULT_OLLAMA_URL;
            if (!RESPONSE_LENGTHS[this.data.settings.responseLength]) this.data.settings.responseLength = DEFAULT_LENGTH;
            this.data.settings.contextTokens = this.clampContextTokens(this.data.settings.contextTokens);
            if (typeof this.data.settings.thinking !== 'boolean') this.data.settings.thinking = true;
            this.data.userProfile = Object.assign({ name: 'User', desc: '', gender: '', pronouns: '', avatar: '' }, loaded.userProfile || {});
            if (this.isGeneratedAvatarUrl(this.data.userProfile.avatar)) this.data.userProfile.avatar = '';
            this.normalizePersonas(loaded);

            this.data.bots.forEach(character => { this.normalizeCharacterData(character); this.sanitizeVersions(character); });
            this.dataLoaded = true;
        } catch (error) {
            // Saving stays disabled in this state, so an empty fallback can never overwrite the real file.
            console.error('Data load failure:', error);
            this.showErrorNotification('Could not load your saved data, so nothing will be overwritten. Check that the server is running, then reload the page.');
        }
        this.renderUserProfile();
        this.renderCharacterGallery();
        this.loadProviderDrafts();
        this.renderProviderSetting(this.data.settings.provider);
        this.renderLengthSetting(this.data.settings.responseLength);
        this.renderThinkingSetting(this.thinkingEnabled());
        this.renderContextSetting(this.data.settings.contextTokens);
    },

    normalizeCharacterData(character) {
        if (typeof character.name !== 'string') character.name = 'Unnamed character';
        if (typeof character.desc !== 'string') character.desc = '';
        if (typeof character.prompt !== 'string') character.prompt = '';
        if (typeof character.scenario !== 'string') character.scenario = '';
        if (typeof character.avatar !== 'string' || this.isGeneratedAvatarUrl(character.avatar)) character.avatar = '';

        // Opening messages are a list. Older versions stored one "firstmsg".
        const legacyGreeting = typeof character.firstmsg === 'string' ? character.firstmsg : '';
        const greetings = Array.isArray(character.firstmsgs) ? character.firstmsgs : [legacyGreeting];
        character.firstmsgs = greetings.filter(text => typeof text === 'string' && text.trim() !== '');
        if (character.firstmsgs.length === 0) character.firstmsgs = [''];
        delete character.firstmsg;

        if (!Array.isArray(character.chats)) {
            const legacyHistory = Array.isArray(character.history) ? character.history : [];
            character.chats = [{ id: 'chat_' + Date.now(), title: 'Chat 1', updatedAt: Date.now(), history: legacyHistory, greetingIndex: 0, greetingChosen: legacyHistory.length > 0 }];
            delete character.history;
        }
        character.chats.forEach((chat, index) => {
            if (!chat.id) chat.id = 'chat_' + Date.now() + '_' + index;
            // A chat counts as started once a greeting is confirmed or any message exists (older saves: history decides).
            if (typeof chat.greetingChosen !== 'boolean') chat.greetingChosen = chat.history.length > 0;
            if (!chat.title) chat.title = 'Chat ' + (index + 1);
            if (!Array.isArray(chat.history)) chat.history = [];
            if (!Number.isInteger(chat.greetingIndex)) chat.greetingIndex = 0;
        });
        if (character.chats.length === 0) {
            character.chats.push({ id: 'chat_' + Date.now(), title: 'Chat 1', updatedAt: Date.now(), history: [], greetingIndex: 0, greetingChosen: false });
        }
        if (!character.chats.some(chat => chat.id === character.activeChatId)) {
            character.activeChatId = character.chats[0].id;
        }
    },

    getActiveChatSession(character) {
        this.normalizeCharacterData(character);
        return character.chats.find(chat => chat.id === character.activeChatId) || character.chats[0];
    },

    // Which opening message a session started with (clamped in case the list has changed since).
    greetingFor(character, session) {
        const greetings = character.firstmsgs;
        const index = session && Number.isInteger(session.greetingIndex) ? session.greetingIndex : 0;
        return greetings[Math.min(Math.max(index, 0), greetings.length - 1)] || '';
    },

    currentCharacter() {
        return this.data.bots.find(bot => bot.id === this.currentBotId) || null;
    },

    isShowingSession(character, session) {
        return this.currentBotId === character.id && this.getActiveChatSession(character) === session;
    },

    // Saves are sent one at a time with the latest state, so they can never arrive out of order.
    persistApplicationData() {
        if (!this.dataLoaded) {
            this.showErrorNotification("Your saved data didn't load, so this change was not saved. Reload the page once the server is reachable.");
            return Promise.resolve(false);
        }

        if (Array.isArray(this.data.personas) && this.data.personas.length) this.syncActiveUserProfile();

        this.saveQueued = true;
        if (!this.saveLoop) {
            this.saveLoop = (async () => {
                try {
                    while (this.saveQueued) {
                        this.saveQueued = false;
                        try {
                            const response = await fetch('/api/data', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(this.data)
                            });
                            if (!response.ok) throw new Error('HTTP ' + response.status);
                            this.lastSaveOk = true;
                        } catch (error) {
                            this.lastSaveOk = false;
                            console.error('Data synchronization error:', error);
                            this.showErrorNotification("Couldn't save your data to disk. Recent changes may be lost if you close the app.");
                        }
                    }
                } finally {
                    this.saveLoop = null;
                }
            })();
        }
        return this.saveLoop.then(() => this.lastSaveOk);
    },

    /* ============================== navigation ============================== */

    navigateToView(viewId) {
        if (viewId !== 'chat' && this.editingMessage) this.cancelMessageEdit();
        if (this.isGenerating) this.abortResponseGeneration();

        document.querySelectorAll('.view').forEach(element => element.classList.add('hidden'));
        const target = document.getElementById('view-' + viewId);
        if (target) target.classList.remove('hidden');

        const homeButton = document.getElementById('header-home-btn');
        if (homeButton) homeButton.classList.toggle('hidden', viewId !== 'chat' && viewId !== 'overview');

        if (viewId === 'home') {
            this.currentBotId = null;
            this.renderCharacterGallery();
        } else if (viewId === 'create') {
            this.clearCharacterForm();
        } else if (viewId === 'user-profile') {
            this.renderUserProfile();
        } else if (viewId === 'settings') {
            this.loadProviderDrafts();
            this.renderProviderSetting(this.data.settings.provider);
            this.renderLengthSetting(this.data.settings.responseLength);
            this.renderThinkingSetting(this.thinkingEnabled());
            this.renderContextSetting(this.data.settings.contextTokens);
        } else if (viewId === 'overview') {
            this.renderCharacterOverview();
        }

        this.autoGrowAll(target || document);
    },

    /* ============================== helpers ============================== */

    setFieldValue(id, value) {
        const element = document.getElementById(id);
        if (!element) return;
        element.value = value === undefined || value === null ? '' : String(value);
        if (element.hasAttribute('data-autogrow')) this.autoGrow(element);
    },

    getFieldValue(id) {
        const element = document.getElementById(id);
        return element ? element.value : '';
    },

    // Textareas grow to fit their text (including borders), so a long description is never cut off.
    autoGrow(element) {
        if (!element) return;
        if (element.offsetParent === null) {
            element.style.height = '';   // hidden: let CSS decide, and fix the size when it is shown again
            return;
        }
        element.style.height = 'auto';
        element.style.height = (element.scrollHeight + element.offsetHeight - element.clientHeight) + 'px';
    },

    autoGrowAll(root = document) {
        root.querySelectorAll('textarea[data-autogrow]').forEach(element => this.autoGrow(element));
    },

    refreshAvatarPreview(imageId, avatarUrl, name, removeButtonId) {
        document.getElementById(imageId).src = avatarUrl || this.generateAvatar(name);
        if (removeButtonId) document.getElementById(removeButtonId).classList.toggle('hidden', !avatarUrl);
    },

    refreshCharacterAvatarPreview() {
        const fields = AVATAR_FIELDS.character;
        this.refreshAvatarPreview(fields.preview, this.getFieldValue(fields.hidden), this.getFieldValue(fields.name) || 'Bot', fields.remove);
    },

    isGeneratedAvatarUrl(url) {
        return typeof url === 'string' && url.startsWith('https://ui-avatars.com/');
    },

    avatarFor(character) {
        return character.avatar || this.generateAvatar(character.name);
    },

    firstLine(text) {
        return String(text || '').split('\n').map(line => line.trim()).find(Boolean) || '';
    },

    /* ============================== characters: gallery ============================== */

    normalizePersonas(source) {
        const from = source || this.data || {};
        let list = Array.isArray(from.personas) ? from.personas.slice() : [];
        list = list.filter(p => p && typeof p === 'object').map((p, index) => ({
            id: typeof p.id === 'string' && p.id ? p.id : ('persona_' + (index + 1)),
            name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'User',
            gender: typeof p.gender === 'string' ? p.gender : '',
            pronouns: typeof p.pronouns === 'string' ? p.pronouns : '',
            desc: typeof p.desc === 'string' ? p.desc : '',
            avatar: (typeof p.avatar === 'string' && !this.isGeneratedAvatarUrl(p.avatar)) ? p.avatar : ''
        }));

        if (list.length === 0) {
            const legacy = from.userProfile && typeof from.userProfile === 'object' ? from.userProfile : this.data.userProfile;
            list = [{
                id: 'persona_1',
                name: (legacy && legacy.name) || 'User',
                gender: (legacy && legacy.gender) || '',
                pronouns: (legacy && legacy.pronouns) || '',
                desc: (legacy && legacy.desc) || '',
                avatar: (legacy && legacy.avatar && !this.isGeneratedAvatarUrl(legacy.avatar)) ? legacy.avatar : ''
            }];
        }

        this.data.personas = list;
        let activeId = typeof from.activePersonaId === 'string' ? from.activePersonaId : this.data.activePersonaId;
        if (!list.some(p => p.id === activeId)) activeId = list[0].id;
        this.data.activePersonaId = activeId;
        this.syncActiveUserProfile();
    },

    activePersona() {
        const list = Array.isArray(this.data.personas) ? this.data.personas : [];
        return list.find(p => p.id === this.data.activePersonaId) || list[0]
            || { name: 'User', gender: '', pronouns: '', desc: '', avatar: '' };
    },

    syncActiveUserProfile() {
        const p = this.data.personas.find(row => row.id === this.data.activePersonaId) || this.data.personas[0];
        if (!p) return;
        this.data.userProfile = {
            name: p.name || 'User',
            gender: p.gender || '',
            pronouns: p.pronouns || '',
            desc: p.desc || '',
            avatar: p.avatar || ''
        };
    },

    readPersonaForm() {
        return {
            name: this.getFieldValue('user-name-input').trim() || 'User',
            gender: this.getFieldValue('user-gender-input').trim(),
            pronouns: this.getFieldValue('user-pronouns-input').trim(),
            desc: this.getFieldValue('user-desc-input').trim(),
            avatar: this.getFieldValue('user-avatar-base64') || ''
        };
    },

    writePersonaForm(profile) {
        this.setFieldValue('user-name-input', profile.name || '');
        this.setFieldValue('user-gender-input', profile.gender || '');
        this.setFieldValue('user-pronouns-input', profile.pronouns || '');
        this.setFieldValue('user-desc-input', profile.desc || '');
        this.setFieldValue('user-avatar-base64', profile.avatar || '');
        this.refreshAvatarPreview('user-preview-avatar', profile.avatar, profile.name || 'User', 'btn-remove-user-avatar');
    },

    commitPersonaForm() {
        this.normalizePersonas();
        const current = this.data.personas.find(p => p.id === this.data.activePersonaId);
        if (!current) return;
        Object.assign(current, this.readPersonaForm());
        this.syncActiveUserProfile();
    },

    renderPersonaTabs() {
        const tabs = document.getElementById('persona-tabs');
        if (!tabs) return;
        this.normalizePersonas();
        tabs.innerHTML = '';
        this.data.personas.forEach((persona) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'gtab' + (persona.id === this.data.activePersonaId ? ' active' : '');
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', persona.id === this.data.activePersonaId ? 'true' : 'false');
            const label = document.createElement('span');
            label.textContent = persona.name || 'User';
            tab.title = persona.name || 'User';
            tab.appendChild(label);
            if (this.data.personas.length > 1) {
                const close = document.createElement('span');
                close.className = 'gtab-close';
                close.setAttribute('role', 'button');
                close.setAttribute('aria-label', 'Delete persona');
                close.innerHTML = ICON.close;
                close.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.removePersonaTab(persona.id);
                });
                tab.appendChild(close);
            }
            tab.addEventListener('click', () => this.selectPersonaTab(persona.id));
            tabs.appendChild(tab);
        });
    },

    selectPersonaTab(personaId) {
        this.commitPersonaForm();
        if (!this.data.personas.some(p => p.id === personaId)) return;
        this.data.activePersonaId = personaId;
        this.syncActiveUserProfile();
        this.renderUserProfile();
    },

    addPersonaTab() {
        this.commitPersonaForm();
        const id = 'persona_' + Date.now();
        this.data.personas.push({ id, name: 'New persona', gender: '', pronouns: '', desc: '', avatar: '' });
        this.data.activePersonaId = id;
        this.syncActiveUserProfile();
        this.renderUserProfile();
        const nameField = document.getElementById('user-name-input');
        if (nameField) {
            nameField.focus();
            nameField.select();
        }
    },

    async removePersonaTab(personaId) {
        this.normalizePersonas();
        if (this.data.personas.length <= 1) return;
        const persona = this.data.personas.find(p => p.id === personaId);
        if (!persona) return;
        const ok = await this.askConfirm({
            title: 'Delete persona?',
            message: `Remove “${persona.name || 'this persona'}”? This cannot be undone.`,
            confirmLabel: 'Delete'
        });
        if (!ok) return;
        this.commitPersonaForm();
        this.data.personas = this.data.personas.filter(p => p.id !== personaId);
        if (this.data.activePersonaId === personaId) {
            this.data.activePersonaId = this.data.personas[0].id;
        }
        this.syncActiveUserProfile();
        this.renderUserProfile();
    },

    renderUserProfile() {
        this.normalizePersonas();
        const profile = this.activePersona();
        this.writePersonaForm(profile);
        this.renderPersonaTabs();
    },

    persistUserProfile() {
        this.commitPersonaForm();
        this.normalizePersonas();
        this.persistApplicationData();
        this.renderUserProfile();
        this.navigateToView('home');
    },

    filterCharacters() {
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.renderCharacterGallery(), 120);
    },

    renderCharacterGallery() {
        const container = document.getElementById('home-bots-grid');
        const query = this.getFieldValue('bot-search-input').toLowerCase().trim();
        const matches = this.data.bots.filter(character => {
            const haystack = ((character.name || '') + ' ' + (character.desc || '')).toLowerCase();
            return haystack.includes(query);
        });

        container.innerHTML = '';
        container.classList.toggle('hidden', matches.length === 0);

        const empty = document.getElementById('home-empty');
        empty.classList.toggle('hidden', matches.length > 0);
        if (matches.length === 0) {
            const noCharacters = this.data.bots.length === 0;
            document.getElementById('home-empty-title').textContent = noCharacters ? 'No characters yet' : 'Nothing matches';
            document.getElementById('home-empty-text').textContent = noCharacters
                ? 'Create one from scratch, or import a character card (JSON or PNG).'
                : 'Try a different search.';
        }

        matches.forEach(character => {
            this.normalizeCharacterData(character);
            const totalSessions = character.chats.length;
            const card = document.createElement('div');
            card.className = 'interactive-card rounded-3xl overflow-hidden cursor-pointer group flex flex-col h-72 relative animate-slide-up';
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.innerHTML = `
                <div class="h-40 bg-oganesson-900 relative overflow-hidden">
                    <img src="${this.escapeHtml(this.avatarFor(character))}" alt="" class="w-full h-full object-cover group-hover:scale-105 transition duration-500">
                    <div class="absolute inset-0 bg-gradient-to-t from-oganesson-950 via-transparent to-transparent"></div>
                    <button type="button" data-sessions-btn class="absolute top-3 right-3 bg-black/60 hover:bg-violet-600 backdrop-blur-md text-violet-300 hover:text-white border border-violet-500/30 text-[10px] font-extrabold px-2.5 py-1 rounded-full transition interactive-button" title="Manage Sessions">
                        ${totalSessions} Session${totalSessions > 1 ? 's' : ''}
                    </button>
                </div>
                <div class="p-4 flex-1 flex flex-col justify-between">
                    <div>
                        <h3 class="font-bold text-base mb-1 text-white group-hover:text-violet-300 transition">${this.escapeHtml(character.name)}</h3>
                        <p class="text-xs text-gray-400 line-clamp-2 leading-relaxed">${this.escapeHtml(character.desc || 'No description provided.')}</p>
                    </div>
                    <div class="flex items-center justify-between pt-2 border-t border-white/5 text-[10px] uppercase font-bold text-violet-400">
                        <span>View character</span>
                        <span class="group-hover:translate-x-1 transition duration-300">→</span>
                    </div>
                </div>
            `;
            card.addEventListener('click', () => this.openCharacterOverview(character.id));
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && event.target === card) this.openCharacterOverview(character.id);
            });
            card.querySelector('[data-sessions-btn]').addEventListener('click', (event) => {
                event.stopPropagation();
                this.openChatSessionsModal(character.id);
            });
            container.appendChild(card);
        });
    },

    openCharacterOverview(characterId) {
        const character = this.data.bots.find(bot => bot.id === characterId);
        if (!character) {
            this.navigateToView('home');
            return;
        }
        this.currentBotId = characterId;
        this.normalizeCharacterData(character);
        this.overviewGreetingIndex = 0;
        this.navigateToView('overview');
    },

    renderCharacterOverview() {
        const character = this.currentCharacter();
        if (!character) {
            this.navigateToView('home');
            return;
        }
        this.normalizeCharacterData(character);

        const nameEl = document.getElementById('overview-name');
        if (nameEl) nameEl.querySelector('h2').textContent = character.name || 'Character';

        const desc = (character.desc || '').trim();
        document.getElementById('overview-desc').textContent = desc || 'No description provided.';

        const avatar = document.getElementById('overview-avatar');
        if (avatar) {
            avatar.src = this.avatarFor(character);
            avatar.alt = character.name || '';
        }

        const prompt = (character.prompt || '').trim();
        document.getElementById('overview-prompt').textContent = prompt || 'No personality notes yet.';

        const scenario = (character.scenario || '').trim();
        document.getElementById('overview-scenario').textContent = scenario
            ? this.applyMacros(scenario, character)
            : 'No scenario set for this character.';

        // Sections start collapsed each time the overview opens.
        document.querySelectorAll('#overview-sections .overview-section').forEach((section) => {
            section.classList.remove('is-open');
            const head = section.querySelector('[data-overview-toggle]');
            if (head) head.setAttribute('aria-expanded', 'false');
        });

        if (!Number.isInteger(this.overviewGreetingIndex)) this.overviewGreetingIndex = 0;
        this.overviewGreetingIndex = Math.min(Math.max(this.overviewGreetingIndex, 0), character.firstmsgs.length - 1);
        this.renderOverviewGreetingTabs(character);
    },

    renderOverviewGreetingTabs(character) {
        const tabs = document.getElementById('overview-greeting-tabs');
        const textEl = document.getElementById('overview-greeting-text');
        if (!tabs || !textEl) return;

        const greetings = character.firstmsgs || [''];
        const current = Math.min(Math.max(this.overviewGreetingIndex || 0, 0), greetings.length - 1);
        this.overviewGreetingIndex = current;

        tabs.innerHTML = '';
        greetings.forEach((text, index) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'gtab' + (index === current ? ' active' : '');
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', index === current ? 'true' : 'false');
            tab.textContent = 'Greeting ' + (index + 1);
            tab.addEventListener('click', (event) => {
                event.stopPropagation();
                this.overviewGreetingIndex = index;
                this.renderOverviewGreetingTabs(character);
            });
            tabs.appendChild(tab);
        });

        const raw = greetings[current] || '';
        textEl.textContent = raw.trim()
            ? this.applyMacros(raw, character)
            : 'No opening message for this tab.';
    },

    toggleOverviewSection(button) {
        const section = button && button.closest('.overview-section');
        if (!section) return;
        const open = !section.classList.contains('is-open');
        section.classList.toggle('is-open', open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
    },

    /* ============================== characters: editor ============================== */

    clearCharacterForm() {
        this.setFieldValue('bot-edit-id', '');
        document.getElementById('create-title').textContent = 'Create character';
        this.fillCharacterForm({ name: '', desc: '', prompt: '', scenario: '', firstmsgs: [''], avatar: '' });
        document.getElementById('bot-avatar-file').value = '';
        document.getElementById('btn-delete-bot').classList.add('hidden');
        document.getElementById('btn-export-bot').classList.add('hidden');
    },

    fillCharacterForm(fields) {
        this.setFieldValue('bot-name', fields.name || '');
        this.setFieldValue('bot-desc', fields.desc || '');
        this.setFieldValue('bot-prompt', fields.prompt || '');
        this.setFieldValue('bot-scenario', fields.scenario || '');
        this.setGreetingDraft(fields.firstmsgs);
        this.setFieldValue('bot-avatar-base64', fields.avatar || '');
        this.refreshAvatarPreview('preview-avatar', fields.avatar || '', fields.name || 'Bot', 'btn-remove-avatar');
    },

    saveCharacter() {
        const editingId = this.getFieldValue('bot-edit-id');
        const name = this.getFieldValue('bot-name').trim();
        const avatar = this.getFieldValue('bot-avatar-base64') || '';
        const desc = this.getFieldValue('bot-desc').trim();
        const prompt = this.getFieldValue('bot-prompt').trim();
        const scenario = this.getFieldValue('bot-scenario').trim();
        const greetings = this.collectGreetings();

        const missing = [];
        if (!name) missing.push(['bot-name', 'a character name']);
        if (!prompt) missing.push(['bot-prompt', 'the personality & traits']);
        if (greetings.length === 0) missing.push(['bot-firstmsg', 'at least one opening greeting']);
        if (missing.length) {
            const names = missing.map(item => item[1]);
            this.showErrorNotification('Please add ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]) + '.');
            const first = document.getElementById(missing[0][0]);
            if (first) {
                first.focus({ preventScroll: true });
                first.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
            return;
        }

        let targetId = editingId;
        if (editingId) {
            const character = this.data.bots.find(bot => bot.id === editingId);
            if (character) Object.assign(character, { name, avatar, desc, prompt, scenario, firstmsgs: greetings });
        } else {
            targetId = Date.now().toString();
            const session = { id: 'chat_' + Date.now(), title: 'Chat 1', updatedAt: Date.now(), history: [], greetingIndex: 0, greetingChosen: false };
            this.data.bots.push({ id: targetId, name, avatar, desc, prompt, scenario, firstmsgs: greetings, chats: [session], activeChatId: session.id });
        }

        this.persistApplicationData();
        this.clearCharacterForm();
        this.openCharacterOverview(targetId);
    },

    editSelectedCharacter() {
        const character = this.currentCharacter();
        if (!character) return;
        this.navigateToView('create');
        document.getElementById('create-title').textContent = 'Edit character';
        this.setFieldValue('bot-edit-id', character.id);
        this.fillCharacterForm(character);
        document.getElementById('btn-delete-bot').classList.remove('hidden');
        document.getElementById('btn-export-bot').classList.remove('hidden');
    },

    async removeSelectedCharacter() {
        const characterId = this.getFieldValue('bot-edit-id');
        if (!characterId) return;
        const character = this.data.bots.find(bot => bot.id === characterId);
        const name = (character && character.name) || 'this character';
        const ok = await this.askConfirm({
            title: 'Delete character?',
            message: `Delete “${name}” and all of its chats? This cannot be undone.`,
            confirmLabel: 'Delete'
        });
        if (!ok) return;
        this.data.bots = this.data.bots.filter(bot => bot.id !== characterId);
        this.persistApplicationData();
        this.currentBotId = null;
        this.navigateToView('home');
    },

    uploadAvatar(event, fieldKey) {
        const fields = AVATAR_FIELDS[fieldKey];
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        if (file.type && !file.type.startsWith('image/')) {
            this.showErrorNotification('Please choose an image file.');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            this.resizeImageToDataUrl(reader.result)
                .then((dataUrl) => {
                    this.setFieldValue(fields.hidden, dataUrl);
                    this.refreshAvatarPreview(fields.preview, dataUrl, this.getFieldValue(fields.name) || 'Bot', fields.remove);
                })
                .catch(() => this.showErrorNotification('Could not read this image. Please choose a different file.'));
        };
        reader.readAsDataURL(file);
    },

    resetAvatar(fieldKey) {
        const fields = AVATAR_FIELDS[fieldKey];
        this.setFieldValue(fields.hidden, '');
        this.refreshAvatarPreview(fields.preview, '', this.getFieldValue(fields.name) || 'Bot', fields.remove);
    },

    resizeImageToDataUrl(source, maxDimension = 512) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');
                let width = image.width, height = image.height;
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) { height = Math.round((height * maxDimension) / width); width = maxDimension; }
                    else { width = Math.round((width * maxDimension) / height); height = maxDimension; }
                }
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(image, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            image.onerror = () => reject(new Error('Could not read this image.'));
            image.src = source;
        });
    },

    /* ============================== opening messages (tabs) ============================== */

    setGreetingDraft(list) {
        this.draftGreetings = Array.isArray(list) && list.length ? list.slice() : [''];
        this.activeGreeting = 0;
        this.renderGreetingTabs();
        this.syncGreetingEditor();
    },

    collectGreetings() {
        return this.draftGreetings.map(text => text.trim()).filter(text => text.length > 0);
    },

    renderGreetingTabs() {
        const strip = document.getElementById('greeting-tabs');
        const canClose = this.draftGreetings.length > 1;
        strip.innerHTML = '';

        this.draftGreetings.forEach((text, index) => {
            const tab = document.createElement('div');
            tab.className = 'gtab' + (index === this.activeGreeting ? ' active' : '');
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', index === this.activeGreeting ? 'true' : 'false');
            tab.dataset.index = String(index);
            tab.title = text && text.trim() ? this.firstLine(text) : 'Empty opening message';
            tab.innerHTML = `<span>Message ${index + 1}</span>` + (canClose
                ? `<button type="button" class="gtab-close" data-close="${index}" title="Remove message ${index + 1}" aria-label="Remove message ${index + 1}">${ICON.close}</button>`
                : '');
            strip.appendChild(tab);
        });

        this.revealActiveGreetingTab(strip);
    },

    // When there are more tabs than fit, the tab list scrolls (the "+" stays put) and the selected tab is kept in view.
    revealActiveGreetingTab(strip) {
        const active = strip.querySelector('.gtab.active');
        if (!active) return;
        const left = active.offsetLeft;
        const right = left + active.offsetWidth;
        if (left < strip.scrollLeft) {
            strip.scrollLeft = left;
        } else if (right > strip.scrollLeft + strip.clientWidth) {
            strip.scrollLeft = right - strip.clientWidth;
        }
    },

    syncGreetingEditor() {
        const editor = document.getElementById('bot-firstmsg');
        editor.value = this.draftGreetings[this.activeGreeting] || '';
        this.autoGrow(editor);
    },

    handleGreetingTabClick(event) {
        const closeButton = event.target.closest('[data-close]');
        if (closeButton) {
            event.stopPropagation();
            this.removeGreetingTab(Number(closeButton.dataset.close));
            return;
        }
        const tab = event.target.closest('[data-index]');
        if (tab) this.selectGreetingTab(Number(tab.dataset.index));
    },

    selectGreetingTab(index) {
        if (index < 0 || index >= this.draftGreetings.length) return;
        this.activeGreeting = index;
        this.renderGreetingTabs();
        this.syncGreetingEditor();
        this.focusGreetingEditor();
    },

    // Tabs, line and text box light up together while the editor has focus.
    focusGreetingEditor() {
        document.getElementById('bot-firstmsg').focus({ preventScroll: true });
    },

    addGreetingTab() {
        this.draftGreetings.push('');
        this.activeGreeting = this.draftGreetings.length - 1;
        this.renderGreetingTabs();
        this.syncGreetingEditor();
        document.getElementById('bot-firstmsg').focus();
    },

    async removeGreetingTab(index) {
        if (this.draftGreetings.length <= 1) return;
        if (this.draftGreetings[index].trim()) {
            const ok = await this.askConfirm({
                title: 'Remove greeting?',
                message: 'Remove this opening message?',
                confirmLabel: 'Remove'
            });
            if (!ok) return;
        }

        this.draftGreetings.splice(index, 1);
        if (index < this.activeGreeting) {
            this.activeGreeting--;
        } else if (index === this.activeGreeting) {
            this.activeGreeting = Math.min(index, this.draftGreetings.length - 1);
        }
        this.renderGreetingTabs();
        this.syncGreetingEditor();
    },

    /* ============================== character cards: import / export ============================== */

    importCharacterFile(event) {
        const input = event.target;
        const file = input.files[0];
        if (!file) return;
        const isPng = /\.png$/i.test(file.name) || file.type === 'image/png';
        const reader = new FileReader();

        reader.onload = async (event) => {
            try {
                if (isPng) {
                    // Character cards shared online are usually PNGs with the card JSON hidden inside.
                    const card = this.extractCardFromPng(event.target.result);
                    if (!card) {
                        this.showErrorNotification("This PNG doesn't contain any character card data.");
                        return;
                    }
                    const fields = this.parseCharacterCard(card);
                    if (!fields.avatar) {
                        const objectUrl = URL.createObjectURL(file);
                        try {
                            fields.avatar = await this.resizeImageToDataUrl(objectUrl);
                        } finally {
                            URL.revokeObjectURL(objectUrl);
                        }
                    }
                    this.applyImportedCharacter(fields);
                } else {
                    this.applyImportedCharacter(this.parseCharacterCard(JSON.parse(event.target.result)));
                }
            } catch (error) {
                console.error('Character import failed:', error);
                this.showErrorNotification(isPng ? 'Could not read the character data in this PNG!' : 'Invalid JSON format!');
            } finally {
                input.value = '';
            }
        };
        if (isPng) reader.readAsArrayBuffer(file); else reader.readAsText(file);
    },

    applyImportedCharacter(fields) {
        this.navigateToView('create');
        this.fillCharacterForm(fields);
    },

    // Maps the card formats found in the wild (TavernAI v1, Character Card V2/V3, and this app's own exports).
    parseCharacterCard(parsedJson) {
        if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) throw new Error('Not a character card');
        const card = (parsedJson.data && typeof parsedJson.data === 'object') ? parsedJson.data : parsedJson;
        const text = (value) => (typeof value === 'string' ? value : '');

        const name = text(card.name).trim() || text(card.char_name).trim() || 'Imported character';
        const scenario = text(card.scenario) || text(card.world_scenario);
        const avatar = /^data:image\//i.test(text(card.avatar)) ? card.avatar : '';

        // Files from the first version of this app: flat, "description" was the tagline and "personality" the prompt.
        const isFirstVersionExport = !parsedJson.data && 'personality' in card
            && !('creator_notes' in card) && !('mes_example' in card) && !('char_persona' in card);
        if (isFirstVersionExport) {
            return { name, desc: text(card.description), prompt: text(card.personality), scenario, firstmsgs: this.cleanGreetings([text(card.first_mes)]), avatar };
        }

        const greetings = this.cleanGreetings([
            text(card.first_mes) || text(card.char_greeting) || text(card.greeting),
            ...(Array.isArray(card.alternate_greetings) ? card.alternate_greetings.map(text) : [])
        ]);

        // Files exported by this app keep every field exactly where it came from.
        const isOwnExport = !!(card.extensions && card.extensions.source === 'oganesson-ai');
        if (isOwnExport) {
            return { name, desc: text(card.creator_notes), prompt: text(card.description), scenario, firstmsgs: greetings, avatar };
        }

        // Cards from other tools: the definition, personality, and example dialogue all go into the prompt the model sees.
        const definition = (text(card.description) || text(card.char_persona)).trim();
        const personality = text(card.personality).trim();
        const example = (text(card.mes_example) || text(card.example_dialogue)).replace(/<START>/gi, '---').trim();
        const promptParts = [definition];
        if (personality) promptParts.push('Personality: ' + personality);
        if (example) promptParts.push('[EXAMPLE DIALOGUE]\n' + example);

        return {
            name,
            desc: this.htmlToPlainText(text(card.creator_notes)),   // for the user only; never sent to the model
            prompt: promptParts.filter(Boolean).join('\n\n'),
            scenario,
            firstmsgs: greetings,
            avatar
        };
    },

    cleanGreetings(list) {
        const cleaned = [];
        list.forEach(item => {
            const value = typeof item === 'string' ? item.trim() : '';
            if (value && !cleaned.includes(value)) cleaned.push(value);
        });
        return cleaned.length ? cleaned : [''];
    },

    htmlToPlainText(raw) {
        return String(raw || '')
            .replace(/<\s*br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#0?39;/gi, "'")
            .replace(/&amp;/gi, '&')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    },

    // Reads the base64 JSON that character-card tools store in a PNG text chunk ("chara" for V2, "ccv3" for V3).
    extractCardFromPng(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        const signature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) return null;

        const view = new DataView(arrayBuffer);
        const latin1 = new TextDecoder('latin1');
        const found = {};
        let offset = 8;

        while (offset + 12 <= bytes.length) {
            const length = view.getUint32(offset);
            const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
            const dataStart = offset + 8;
            const dataEnd = dataStart + length;
            if (dataEnd > bytes.length) break;
            if (type === 'IEND') break;

            if (type === 'tEXt') {
                const separator = bytes.indexOf(0, dataStart);
                if (separator > dataStart && separator < dataEnd) {
                    const keyword = latin1.decode(bytes.subarray(dataStart, separator));
                    if (keyword === 'chara' || keyword === 'ccv3') {
                        found[keyword] = latin1.decode(bytes.subarray(separator + 1, dataEnd));
                    }
                }
            }
            offset = dataEnd + 4;   // skip the CRC
        }

        const encoded = found.ccv3 || found.chara;
        if (!encoded) return null;
        const binary = atob(encoded.trim());
        const utf8Bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        return JSON.parse(new TextDecoder('utf-8').decode(utf8Bytes));
    },

    exportCharacterFile() {
        const createVisible = !document.getElementById('view-create').classList.contains('hidden');
        const characterId = createVisible ? this.getFieldValue('bot-edit-id') : this.currentBotId;
        const character = this.data.bots.find(bot => bot.id === characterId);
        if (!character) return;

        // Standard Character Card V2 layout, so the file also opens in other character-chat tools.
        const payload = {
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: {
                name: character.name,
                description: character.prompt || '',
                personality: '',
                scenario: character.scenario || '',
                first_mes: character.firstmsgs[0] || '',
                mes_example: '',
                creator_notes: character.desc || '',
                system_prompt: '',
                post_history_instructions: '',
                alternate_greetings: character.firstmsgs.slice(1),
                tags: [],
                creator: '',
                character_version: '',
                extensions: { source: 'oganesson-ai' },
                avatar: character.avatar || ''
            }
        };

        const safeName = (character.name || 'character').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'character';
        const link = document.createElement('a');
        link.setAttribute('href', 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2)));
        link.setAttribute('download', safeName + '_character.json');
        document.body.appendChild(link);
        link.click();
        link.remove();
    },

    /* ============================== chat sessions ============================== */

    openChatSessionsModal(characterId) {
        const character = this.data.bots.find(bot => bot.id === characterId);
        if (!character) return;
        this.modalBotId = characterId;
        this.normalizeCharacterData(character);
        document.getElementById('modal-bot-avatar').src = this.avatarFor(character);
        document.getElementById('modal-bot-name').textContent = character.name;
        this.renderChatSessionsList(character);
        this.openPopup(document.getElementById('modal-chats'));
    },

    closeChatSessionsModal() {
        this.closePopup(document.getElementById('modal-chats')).then(() => {
            this.modalBotId = null;
        });
    },

    renderChatSessionsList(character) {
        const container = document.getElementById('modal-chats-list');
        container.innerHTML = '';
        const count = character.chats.length;
        document.getElementById('modal-chats-count').textContent = `${count} Active Session${count > 1 ? 's' : ''}`;

        character.chats.forEach(session => {
            const last = session.history.length ? session.history[session.history.length - 1] : null;
            const preview = last ? last.content : this.applyMacros(this.greetingFor(character, session), character);
            const time = session.updatedAt
                ? new Date(session.updatedAt).toLocaleDateString() + ' ' + new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';

            const row = document.createElement('div');
            row.className = `p-3 rounded-2xl border transition flex items-center justify-between gap-3 ${character.activeChatId === session.id ? 'bg-violet-600/20 border-violet-500' : 'bg-oganesson-900/80 border-oganesson-800 hover:border-oganesson-700'}`;
            row.innerHTML = `
                <div data-open class="flex-1 truncate cursor-pointer">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-xs text-white">${this.escapeHtml(session.title)}</span>
                        <span class="text-[10px] text-gray-500">${this.escapeHtml(time)}</span>
                    </div>
                    <p class="text-[11px] text-gray-400 truncate mt-0.5">${this.formatInline(preview)}</p>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" data-open class="md-btn md-filled md-violet md-sm">Open</button>
                    <button type="button" data-delete class="md-icon-btn sm md-rose" title="Delete session" aria-label="Delete session">${ICON.trashLg}</button>
                </div>
            `;
            row.querySelectorAll('[data-open]').forEach(element => {
                element.addEventListener('click', () => this.switchChatSession(character.id, session.id));
            });
            const deleteButton = row.querySelector('[data-delete]');
            if (deleteButton) {
                deleteButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.removeChatSession(character.id, session.id);
                });
            }
            container.appendChild(row);
        });
    },

    nextChatTitle(character) {
        const used = character.chats
            .map(chat => /^Chat (\d+)$/.exec(chat.title))
            .filter(Boolean)
            .map(match => parseInt(match[1], 10));
        return 'Chat ' + ((used.length ? Math.max(...used) : 0) + 1);
    },

    createChatSession(characterId) {
        const targetId = characterId || this.modalBotId || this.currentBotId;
        const character = this.data.bots.find(bot => bot.id === targetId);
        if (!character) return;
        this.normalizeCharacterData(character);

        const session = { id: 'chat_' + Date.now(), title: this.nextChatTitle(character), updatedAt: Date.now(), history: [], greetingIndex: 0, greetingChosen: false };
        character.chats.unshift(session);
        character.activeChatId = session.id;

        this.persistApplicationData();
        this.closeChatSessionsModal();
        this.startChatSession(character.id, session.id);
    },

    switchChatSession(characterId, sessionId) {
        const character = this.data.bots.find(bot => bot.id === characterId);
        if (!character) return;
        character.activeChatId = sessionId;
        this.persistApplicationData();
        this.closeChatSessionsModal();
        this.startChatSession(characterId, sessionId);
    },

    async removeChatSession(characterId, sessionId) {
        const character = this.data.bots.find(bot => bot.id === characterId);
        if (!character) return;
        const session = character.chats.find(chat => chat.id === sessionId);
        if (!session) return;
        const title = session.title || 'this chat';
        const ok = await this.askConfirm({
            title: 'Delete chat?',
            message: `Delete “${title}”? This cannot be undone.`,
            confirmLabel: 'Delete'
        });
        if (!ok) return;

        const wasActive = character.activeChatId === sessionId;
        if (character.chats.length <= 1) {
            // Keep one session so the character always has a chat to open.
            const fresh = { id: 'chat_' + Date.now(), title: 'Chat 1', updatedAt: Date.now(), history: [], greetingIndex: 0, greetingChosen: false };
            character.chats = [fresh];
            character.activeChatId = fresh.id;
        } else {
            character.chats = character.chats.filter(chat => chat.id !== sessionId);
            if (wasActive) character.activeChatId = character.chats[0].id;
        }
        this.persistApplicationData();

        // If the session on screen was deleted, show the one that is now active so new messages go where you can see them.
        const chatViewOpen = !document.getElementById('view-chat').classList.contains('hidden');
        if (wasActive && this.currentBotId === characterId && chatViewOpen) {
            this.startChatSession(characterId);
        }
        this.renderChatSessionsList(character);
        if (this.chatActionPanel === 'resume') this.renderChatActionResumeList(character);
    },

    /* ============================== chat action popup ============================== */

    openChatActionModal() {
        const character = this.currentCharacter();
        if (!character) return;
        this.normalizeCharacterData(character);
        this.chatActionPanel = 'menu';
        this.showChatActionPanel('menu');
        this.openPopup(document.getElementById('chat-action-modal'));
    },

    closeChatActionModal() {
        const modal = document.getElementById('chat-action-modal');
        this.closePopup(modal).then(() => {
            this.chatActionPanel = 'menu';
            this.showChatActionPanel('menu');
        });
    },

    /* Popup panel and backdrop blur share one 250ms duration (matches the original pop-in). */
    openPopup(modal) {
        if (!modal) return;
        if (modal._closing) {
            modal._closing.cancel = true;
        }
        modal.classList.remove('hidden');
        modal.getAnimations().forEach(animation => animation.cancel());
        const panel = modal.querySelector('.chat-overlay-panel');
        if (panel) panel.getAnimations().forEach(animation => animation.cancel());
        const duration = 250;
        modal.animate(
            [
                { backgroundColor: 'rgba(0,0,0,0)', backdropFilter: 'blur(0px)' },
                { backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)' }
            ],
            { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
        );
        if (panel) {
            panel.animate(
                [
                    { opacity: 0, transform: 'scale(0.9)' },
                    { opacity: 1, transform: 'scale(1)' }
                ],
                { duration, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' }
            );
        }
    },

    closePopup(modal) {
        if (!modal || modal.classList.contains('hidden')) return Promise.resolve();
        const panel = modal.querySelector('.chat-overlay-panel');
        const duration = 250;
        const blur = modal.animate(
            [
                { backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)' },
                { backgroundColor: 'rgba(0,0,0,0)', backdropFilter: 'blur(0px)' }
            ],
            { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
        );
        if (panel) {
            panel.animate(
                [
                    { opacity: 1, transform: 'scale(1)' },
                    { opacity: 0, transform: 'scale(0.9)' }
                ],
                { duration, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' }
            );
        }
        const ticket = { cancel: false };
        modal._closing = ticket;
        return blur.finished.catch(() => {}).then(() => {
            if (ticket.cancel) return;
            modal.classList.add('hidden');
            modal.getAnimations().forEach(animation => animation.cancel());
            if (panel) panel.getAnimations().forEach(animation => animation.cancel());
            if (modal._closing === ticket) modal._closing = null;
        });
    },

    showChatActionPanel(panel) {
        this.chatActionPanel = panel;
        const menu = document.getElementById('chat-action-menu');
        const resume = document.getElementById('chat-action-resume');
        const persona = document.getElementById('chat-action-persona');
        const message = document.getElementById('chat-action-message');
        if (menu) menu.classList.toggle('hidden', panel !== 'menu');
        if (resume) resume.classList.toggle('hidden', panel !== 'resume');
        if (persona) persona.classList.toggle('hidden', panel !== 'persona');
        if (message) {
            message.textContent = panel === 'resume'
                ? 'Pick a previous chat to continue, or delete one you no longer need.'
                : panel === 'persona'
                    ? 'Choose which persona the character should know you as.'
                    : 'Choose how you want to continue with this character.';
        }
        if (panel === 'resume') this.renderChatActionResumeList(this.currentCharacter());
        if (panel === 'persona') this.renderChatActionPersonaList();
    },

    renderChatActionResumeList(character) {
        const list = document.getElementById('chat-action-resume-list');
        const countEl = document.getElementById('chat-action-resume-count');
        if (!list || !character) return;
        this.normalizeCharacterData(character);
        list.innerHTML = '';
        const count = character.chats.length;
        if (countEl) countEl.textContent = count + (count === 1 ? ' chat' : ' chats');

        character.chats.forEach((session) => {
            const last = session.history.length ? session.history[session.history.length - 1] : null;
            const preview = last ? last.content : this.applyMacros(this.greetingFor(character, session), character);
            const time = session.updatedAt
                ? new Date(session.updatedAt).toLocaleDateString() + ' ' + new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';

            const row = document.createElement('div');
            row.className = 'chat-action-row' + (character.activeChatId === session.id ? ' is-active' : '');
            row.innerHTML = `
                <button type="button" class="chat-action-row-main" data-open>
                    <span class="chat-action-row-title">${this.escapeHtml(session.title)}</span>
                    <span class="chat-action-row-meta">${this.escapeHtml(time)}</span>
                    <span class="chat-action-row-preview">${this.formatInline(preview)}</span>
                </button>
                <button type="button" class="md-icon-btn sm md-rose shrink-0" data-delete title="Delete chat" aria-label="Delete chat">${ICON.trashLg}</button>
            `;
            row.querySelector('[data-open]').addEventListener('click', () => {
                this.closeChatActionModal();
                this.switchChatSession(character.id, session.id);
            });
            const del = row.querySelector('[data-delete]');
            if (del) {
                del.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.removeChatSession(character.id, session.id);
                });
            }
            list.appendChild(row);
        });
    },

    renderChatActionPersonaList() {
        const list = document.getElementById('chat-action-persona-list');
        if (!list) return;
        this.normalizePersonas();
        list.innerHTML = '';
        this.data.personas.forEach((persona) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'chat-action-row chat-action-row-button' + (persona.id === this.data.activePersonaId ? ' is-active' : '');
            const avatar = persona.avatar || this.generateAvatar(persona.name || 'User');
            row.innerHTML = `
                <img src="${this.escapeHtml(avatar)}" alt="" class="chat-action-persona-avatar">
                <span class="chat-action-row-main">
                    <span class="chat-action-row-title">${this.escapeHtml(persona.name || 'User')}</span>
                    <span class="chat-action-row-preview">${this.escapeHtml([persona.pronouns, persona.gender].filter(Boolean).join(' · ') || 'No extra details')}</span>
                </span>
            `;
            row.addEventListener('click', () => {
                this.data.activePersonaId = persona.id;
                this.syncActiveUserProfile();
                this.persistApplicationData();
                this.closeChatActionModal();
            });
            list.appendChild(row);
        });
    },

    /* ============================== chat view ============================== */

    startChatSession(characterId, sessionId = null) {
        this.pendingGreeting = null;
        if (this.editingMessage) this.cancelMessageEdit();
        if (this.isGenerating) this.abortResponseGeneration();

        const character = this.data.bots.find(bot => bot.id === characterId);
        if (!character) {
            this.navigateToView('home');
            return;
        }
        this.currentBotId = characterId;
        this.normalizeCharacterData(character);
        if (sessionId) character.activeChatId = sessionId;
        const session = this.getActiveChatSession(character);
        const avatar = this.avatarFor(character);

        document.getElementById('chat-header-name').textContent = character.name;
        document.getElementById('chat-header-desc').textContent = this.firstLine(character.desc);
        document.getElementById('chat-header-avatar').src = avatar;
        document.getElementById('chat-session-badge').textContent = session.title;

        const scenario = (character.scenario || '').trim();
        document.getElementById('chat-scenario-text').textContent = scenario
            ? this.applyMacros(scenario, character)
            : 'No scenario set for this character.';
        document.getElementById('chat-scenario-banner').classList.add('hidden');

        this.navigateToView('chat');
        this.renderMessageHistory();
    },

    toggleScenarioContext() {
        document.getElementById('chat-scenario-banner').classList.toggle('hidden');
    },

    renderMessageHistory(excludeLast = false) {
        const character = this.currentCharacter();
        if (!character) return;
        const session = this.getActiveChatSession(character);
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';

        this.renderSingleMessage('assistant', this.applyMacros(this.greetingFor(character, session), character), character, -1, 'Opening');
        (excludeLast ? session.history.slice(0, -1) : session.history).forEach((msg, index) => {
            this.renderSingleMessage(msg.role, msg.content, character, index, msg.time, false, msg);
        });

        this.renderGreetingPicker(character, session);
        document.getElementById('regenerate-btn').classList.toggle('hidden', session.history.length === 0);
        this.markEditingMessage();
        this.scrollChatToBottom();
    },

    // Before the first message, a character with several openings lets you pick which one this chat starts with.
    // New chat with several greetings: a full-height carousel replaces the message list until the first message is sent.
    // The picker is shown for a chat that has not started yet and has more than one opening message.
    greetingPickerNeeded(character, session) {
        return session.history.length === 0 && !session.greetingChosen && character.firstmsgs.length > 1;
    },

    // The pending choice lives only in memory until the user confirms it. Nothing is saved before that.
    pendingGreetingFor(session) {
        return this.pendingGreeting && this.pendingGreeting.sessionId === session.id ? this.pendingGreeting.index : null;
    },

    // The bottom slot of the chat holds one of three things: the message bar, the green confirm bubble, or nothing.
    // Both items sit in the same grid cell, so swapping them animates instead of jumping.
    setChatDock(mode) {
        const composer = document.getElementById('chat-composer');
        const confirm = document.getElementById('greeting-confirm');
        if (!composer || !confirm) return;
        const showComposer = mode === 'composer';
        const showConfirm = mode === 'confirm';
        composer.classList.toggle('is-away', !showComposer);
        composer.inert = !showComposer;
        confirm.classList.toggle('is-away', !showConfirm);
        confirm.inert = !showConfirm;
    },

    renderGreetingPicker(character, session) {
        const picker = document.getElementById('greeting-picker');
        const show = this.greetingPickerNeeded(character, session);
        picker.classList.toggle('hidden', !show);
        picker.classList.toggle('flex', show);
        picker.classList.remove('is-leaving');
        document.getElementById('chat-messages').classList.toggle('hidden', show);
        if (!show) {
            picker.innerHTML = '';
            this.setChatDock('composer');
            return;
        }

        const pending = this.pendingGreetingFor(session);
        const count = character.firstmsgs.length;
        const arrow = (side, label, path) => `
            <button type="button" class="gp-arrow gp-arrow-${side} md-icon-btn md-violet hidden" data-gp="${side === 'left' ? 'prev' : 'next'}" aria-label="${label}">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="${path}"></path></svg>
            </button>`;
        picker.innerHTML = `
            <div class="text-center mb-3 shrink-0 gp-intro">
                <p class="text-[11px] font-extrabold uppercase tracking-wider text-violet-300">Choose how this chat opens</p>
                <p class="text-xs text-gray-400 mt-1">Read the opening messages, then pick the one to start with.</p>
            </div>
            <div class="gp-stage">
                ${arrow('left', 'Previous greetings', 'M15 19l-7-7 7-7')}
                <div class="gp-track" id="gp-track" role="radiogroup" aria-label="Opening greetings" style="--max:${Math.min(count, 3)}">
                    ${character.firstmsgs.map((text, index) => `
                        <button type="button" role="radio" aria-checked="${index === pending}" data-greeting="${index}" style="--i:${index}" class="gp-card${index === pending ? ' is-selected' : ''}">
                            <span class="gp-card-head"><span class="gp-card-label">Greeting ${index + 1}</span><span class="gp-card-check" aria-hidden="true">${ICON.check}</span></span>
                            <span class="gp-card-body">${this.parseMessageFormatting(this.applyMacros(text, character))}</span>
                        </button>`).join('')}
                </div>
                ${arrow('right', 'Next greetings', 'M9 5l7 7-7 7')}
            </div>`;

        const track = picker.querySelector('#gp-track');
        track.addEventListener('scroll', () => this.queueGreetingArrows(), { passive: true });
        const selected = track.querySelector('.is-selected');
        if (selected && selected.offsetLeft > 0) track.scrollTo({ left: selected.offsetLeft, behavior: 'instant' });
        this.queueGreetingArrows();
        this.syncGreetingConfirm(character, session);
    },

    // Shows the green confirm bubble in place of the message bar once a card is selected.
    syncGreetingConfirm(character, session) {
        const pending = this.pendingGreetingFor(session);
        const label = document.getElementById('greeting-confirm-label');
        if (pending === null) {
            this.setChatDock('none');
            return;
        }
        if (label) label.textContent = 'Start with Greeting ' + (pending + 1);
        this.setChatDock('confirm');
    },

    // Arrows appear only when there is more to see in that direction.
    updateGreetingArrows() {
        const track = document.getElementById('gp-track');
        if (!track) return;
        const max = track.scrollWidth - track.clientWidth;
        document.querySelectorAll('#greeting-picker [data-gp]').forEach((button) => {
            const back = button.dataset.gp === 'prev';
            button.classList.toggle('hidden', max <= 1 || (back ? track.scrollLeft <= 1 : track.scrollLeft >= max - 1));
        });
    },

    queueGreetingArrows() {
        if (this.arrowFrame) return;
        this.arrowFrame = requestAnimationFrame(() => {
            this.arrowFrame = 0;
            this.updateGreetingArrows();
        });
    },

    // One arrow press moves one screenful (the cards snap into place).
    scrollGreetings(direction) {
        const track = document.getElementById('gp-track');
        if (!track) return;
        const gap = parseFloat(getComputedStyle(track).columnGap) || 16;
        track.scrollBy({ left: direction * (track.clientWidth + gap), behavior: 'smooth' });
    },

    greetingIndexOf(character, session) {
        return Math.min(Math.max(Number.isInteger(session.greetingIndex) ? session.greetingIndex : 0, 0), character.firstmsgs.length - 1);
    },

    // Selecting a card only marks it. The chat does not start until the user confirms with the green bubble.
    chooseGreeting(index) {
        const character = this.currentCharacter();
        if (!character) return;
        const session = this.getActiveChatSession(character);
        if (!this.greetingPickerNeeded(character, session) || index < 0 || index >= character.firstmsgs.length) return;
        const previous = this.pendingGreetingFor(session);
        this.pendingGreeting = { sessionId: session.id, index };

        document.querySelectorAll('#greeting-picker [data-greeting]').forEach((card) => {
            const chosen = Number(card.dataset.greeting) === index;
            card.classList.toggle('is-selected', chosen);
            card.setAttribute('aria-checked', String(chosen));
        });
        const bubble = document.getElementById('greeting-confirm');
        if (bubble && previous !== index) {
            // Restart the swap animation when the choice changes while the bubble is already showing.
            bubble.classList.remove('is-swapped');
            void bubble.offsetWidth;
            bubble.classList.add('is-swapped');
        }
        this.syncGreetingConfirm(character, session);
    },

    // Starts the chat with the selected greeting: the picker fades out, the chat slides in, the composer rises back.
    async confirmGreeting() {
        const character = this.currentCharacter();
        if (!character) return;
        const session = this.getActiveChatSession(character);
        const index = this.pendingGreetingFor(session);
        if (index === null || !this.greetingPickerNeeded(character, session)) return;

        session.greetingIndex = index;
        session.greetingChosen = true;
        session.updatedAt = Date.now();
        this.pendingGreeting = null;
        this.persistApplicationData();

        const picker = document.getElementById('greeting-picker');
        this.setChatDock('composer');
        if (!this.prefersReducedMotion() && !picker.classList.contains('hidden')) {
            picker.classList.add('is-leaving');
            await new Promise(resolve => setTimeout(resolve, 280));
        }
        if (!this.isShowingSession(character, session)) return;

        this.renderMessageHistory();
        const messages = document.getElementById('chat-messages');
        messages.classList.remove('chat-enter');
        void messages.offsetWidth;
        messages.classList.add('chat-enter');
        const opening = messages.querySelector(':scope > [data-index="-1"]');
        if (opening && !this.prefersReducedMotion()) opening.classList.add('msg-recv-in', 'opening-in');

        const input = document.getElementById('chat-input');
        if (input) input.focus({ preventScroll: true });
    },

    renderSingleMessage(role, content, character, historyIndex = null, timestampStr = null, animate = false, msg = null) {
        const container = document.getElementById('chat-messages');
        const profile = this.activePersona() || {};
        const isUser = role === 'user';
        const personaName = (msg && msg.personaName) || profile.name || 'You';
        const avatarUrl = isUser
            ? ((msg && msg.personaAvatar) || profile.avatar || this.generateAvatar(personaName))
            : this.avatarFor(character);
        const senderName = isUser ? personaName : character.name;
        const displayTimestamp = timestampStr || this.getCurrentTimestamp();

        const wrapperDiv = document.createElement('div');
        const motionClass = animate === 'send' ? 'msg-send-in ' : ((animate === 'receive' || animate === true) ? 'msg-recv-in ' : '');
        wrapperDiv.className = `flex gap-4 items-end ${motionClass}${isUser ? 'flex-row-reverse' : ''}`;
        if (historyIndex !== null) wrapperDiv.dataset.index = String(historyIndex);

        // The streaming reply gets its tools once it is finished.
        const tools = historyIndex === null ? '' : this.messageToolsHtml(isUser, historyIndex) + this.swipeHtml(msg);

        wrapperDiv.innerHTML = `
            <img src="${this.escapeHtml(avatarUrl)}" alt="" class="msg-avatar ${isUser ? 'msg-persona-avatar' : ''} w-10 h-10 rounded-2xl object-cover flex-shrink-0 border border-violet-500/30 shadow-md">
            <div class="group relative max-w-[80%] min-w-0">
                ${isUser ? '' : this.thinkingShellHtml()}
                <div class="message-card ${isUser ? 'bg-[#7c3aed] text-[#ffffff]' : 'glass-panel text-gray-100'} px-5 py-3.5 rounded-3xl shadow-lg leading-relaxed text-sm">
                    <div class="flex items-center justify-between gap-4 mb-1.5 opacity-65 text-[10px] uppercase font-[700] tracking-wider">
                        <span>${this.escapeHtml(senderName)}</span>
                        <span>${this.escapeHtml(displayTimestamp)}</span>
                    </div>
                    <div class="message-body break-words">${this.parseMessageFormatting(content)}</div>
                </div>
                ${tools}
            </div>
        `;
        container.appendChild(wrapperDiv);
        if (!isUser && msg && typeof msg.reasoning === 'string' && msg.reasoning.trim()) {
            this.paintThinking(wrapperDiv, {
                reasoning: msg.reasoning,
                thinking: false,
                hasAnswer: !!String(content || '').trim(),
                collapse: true
            });
        }
        if (animate === 'swipe') this.swipeIn(wrapperDiv, 1);
        this.scrollChatToBottom();
        return wrapperDiv;
    },

    handleMessageAction(event) {
        const toggle = event.target.closest('[data-think-toggle]');
        if (toggle) {
            event.preventDefault();
            const panel = toggle.closest('.think-panel');
            if (!panel) return;
            panel.dataset.userToggled = '1';
            this.setThinkOpen(panel, !panel.classList.contains('is-open'));
            return;
        }
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const row = button.closest('[data-index]');
        if (!row) return;
        const index = Number(row.dataset.index);
        switch (button.dataset.action) {
            case 'copy': this.copyMessageToClipboard(button, index); break;
            case 'edit': this.modifyMessageHistory(index); break;
            case 'delete': this.removeMessageHistory(index); break;
            case 'prev': this.changeReplyVersion(index, -1); break;
            case 'next': this.changeReplyVersion(index, 1); break;
        }
    },

    copyMessageToClipboard(button, index) {
        const character = this.currentCharacter();
        if (!character) return;
        const session = this.getActiveChatSession(character);
        const text = index >= 0
            ? (session.history[index] ? session.history[index].content : '')
            : this.applyMacros(this.greetingFor(character, session), character);

        const done = () => {
            button.innerHTML = ICON.check;
            button.classList.add('is-done');
            setTimeout(() => {
                button.innerHTML = ICON.copy;
                button.classList.remove('is-done');
            }, 1200);
        };
        const fallback = () => {
            const helper = document.createElement('textarea');
            helper.value = text;
            helper.style.position = 'fixed';
            helper.style.opacity = '0';
            document.body.appendChild(helper);
            helper.select();
            document.execCommand('copy');
            helper.remove();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, () => { fallback(); done(); });
        } else {
            fallback();
            done();
        }
    },

    modifyMessageHistory(index) {
        const character = this.currentCharacter();
        if (!character) return;
        const session = this.getActiveChatSession(character);
        const message = session.history[index];
        if (!message) return;
        if (this.isGenerating) {
            this.showErrorNotification('Wait for the reply to finish before editing.');
            return;
        }

        const input = document.getElementById('chat-input');
        if (!input) return;

        if (this.editingMessage && this.editingMessage.message === message) {
            input.focus();
            return;
        }

        if (!this.editingMessage) this.editingMessage = { draft: input.value };
        this.editingMessage.index = index;
        this.editingMessage.message = message;
        this.editingMessage.characterId = character.id;
        this.editingMessage.sessionId = session.id;

        input.value = message.content == null ? '' : String(message.content);
        input.placeholder = 'Edit message...';
        input.form.classList.add('is-editing');
        this.autoGrow(input);
        this.markEditingMessage();
        input.focus();
        const end = input.value.length;
        try { input.setSelectionRange(end, end); } catch (error) { /* some browsers block this on a hidden field */ }
    },

    confirmMessageEdit() {
        const edit = this.editingMessage;
        if (!edit) return;
        const input = document.getElementById('chat-input');
        const character = this.data.bots.find(bot => bot.id === edit.characterId);
        const session = character && character.chats.find(chat => chat.id === edit.sessionId);
        const at = session ? session.history.indexOf(edit.message) : -1;
        const typed = input ? input.value.trim() : '';
        const newText = character ? this.applyMacros(typed, character) : typed;
        this.finishMessageEdit();
        if (at < 0 || newText === '') return;

        edit.message.content = newText;
        if (Array.isArray(edit.message.versions)) edit.message.versions[edit.message.vi] = edit.message.content;
        session.updatedAt = Date.now();
        this.persistApplicationData();
        if (this.isShowingSession(character, session)) this.renderMessageHistory();
    },

    cancelMessageEdit() {
        if (!this.editingMessage) return;
        this.finishMessageEdit();
    },

    finishMessageEdit() {
        const edit = this.editingMessage;
        this.editingMessage = null;
        const input = document.getElementById('chat-input');
        if (input) {
            input.placeholder = 'Type a message...';
            input.value = edit ? edit.draft : '';
            if (input.form) input.form.classList.remove('is-editing');
            this.autoGrow(input);
        }
        this.markEditingMessage();
    },

    markEditingMessage() {
        document.querySelectorAll('#chat-messages [data-index].is-editing-msg').forEach(row => row.classList.remove('is-editing-msg'));
        if (!this.editingMessage) return;
        const row = document.querySelector('#chat-messages [data-index="' + this.editingMessage.index + '"]');
        if (row) row.classList.add('is-editing-msg');
    },

    async removeMessageHistory(index) {
        if (this.isGenerating || this.regenPending) return;
        const character = this.currentCharacter();
        if (!character) return;
        const session = this.getActiveChatSession(character);
        if (!session.history[index]) return;

        const count = session.history.length - index;
        const confirmed = await this.askConfirm({
            title: count === 1 ? 'Delete this message?' : `Delete ${count} messages?`,
            message: count === 1
                ? 'This message will be permanently deleted.'
                : `This message and the ${count - 1} ${count === 2 ? 'message' : 'messages'} after it will be permanently deleted.`
        });
        if (!confirmed || this.currentCharacter() !== character || !session.history[index]) return;

        session.history.splice(index);   // this message and everything below it
        if (session.history.length === 0) session.greetingChosen = false;
        if (this.editingMessage && session.history.indexOf(this.editingMessage.message) < 0) this.cancelMessageEdit();
        session.updatedAt = Date.now();
        this.persistApplicationData();
        if (!this.isShowingSession(character, session)) return;

        await this.animateRowsOut(index);
        document.getElementById('regenerate-btn').classList.toggle('hidden', session.history.length === 0);
        this.renderGreetingPicker(character, session);
    },

    async clearActiveChatHistory() {
        const character = this.currentCharacter();
        if (!character) return;
        const confirmed = await this.askConfirm({
            title: 'Reset this chat?',
            message: 'The messages in this chat will be cleared. This cannot be undone.',
            confirmLabel: 'Reset'
        });
        if (!confirmed || this.currentCharacter() !== character) return;
        if (this.editingMessage) this.cancelMessageEdit();
        if (this.isGenerating) this.abortResponseGeneration();
        const session = this.getActiveChatSession(character);
        this.bumpChatEpoch(session);
        session.history = [];
        session.greetingChosen = false;
        session.updatedAt = Date.now();
        this.persistApplicationData();
        this.renderMessageHistory();
    },

    launchSendButton() {
        const button = document.getElementById('chat-send-btn');
        if (!button || this.prefersReducedMotion()) return;
        button.classList.remove('is-launching');
        void button.offsetWidth;
        button.classList.add('is-launching');
        const stop = () => button.classList.remove('is-launching');
        button.addEventListener('animationend', stop, { once: true });
    },

    scrollChatToBottom() {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        try {
            container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });   // no smooth-scroll lag while streaming
        } catch (error) {
            container.scrollTop = container.scrollHeight;
        }
    },

    isChatNearBottom() {
        const container = document.getElementById('chat-messages');
        return !container || (container.scrollHeight - container.scrollTop - container.clientHeight) < 120;
    },

    handleInputKeyDown(event) {
        if (this.editingMessage && event.key === 'Escape') {
            event.preventDefault();
            this.cancelMessageEdit();
            return;
        }
        // Enter while an input method (Japanese, Chinese, Arabic...) is composing must not send the message.
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            this.dispatchUserMessage(event);
        }
    },

    async dispatchUserMessage(event) {
        if (event) event.preventDefault();
        if (this.editingMessage) {
            this.confirmMessageEdit();
            return;
        }
        if (this.isGenerating || !this.currentBotId) return;

        const input = document.getElementById('chat-input');
        const raw = input.value.trim();
        if (!raw) return;

        const character = this.currentCharacter();
        if (!character) return;
        const session = this.getActiveChatSession(character);
        if (this.greetingPickerNeeded(character, session)) return;   // still choosing the opening message
        const text = this.applyMacros(raw, character);
        session.greetingChosen = true;

        input.value = '';
        this.autoGrow(input);

        const profile = this.activePersona() || {};
        const personaName = profile.name || 'You';
        session.history.push({
            role: 'user',
            content: text,
            time: this.getCurrentTimestamp(),
            personaName,
            personaAvatar: profile.avatar || this.generateAvatar(personaName)
        });
        session.updatedAt = Date.now();
        this.persistApplicationData();
        this.renderGreetingPicker(character, session);
        document.getElementById('regenerate-btn').classList.toggle('hidden', session.history.length === 0);
        this.launchSendButton();
        this.renderSingleMessage('user', text, character, session.history.length - 1, session.history[session.history.length - 1].time, 'send');

        await this.streamModelResponse(character, session);
    },

    async requestResponseRegeneration() {
        if (this.isGenerating || this.regenPending) return;
        const character = this.currentCharacter();
        if (!character) return;
        const session = this.getActiveChatSession(character);
        if (session.history.length === 0) return;

        // The old reply stays in the history (hidden while the new one is written) so it can be brought back with the arrows.
        const regenerate = session.history[session.history.length - 1].role === 'assistant';
        if (regenerate) {
            this.regenPending = true;
            try { await this.hideLastReplyRow(session); } finally { this.regenPending = false; }
            if (!this.isShowingSession(character, session)) return;   // you left the chat in the meantime
        }
        await this.streamModelResponse(character, session, { regenerate });
    },

    // Removes only the reply being regenerated from the screen (the rest of the chat stays untouched).
    // Swipes the reply being regenerated out to the left, then removes it (the rest of the chat stays untouched).
    async hideLastReplyRow(session) {
        const rows = document.querySelectorAll('#chat-messages > [data-index]');
        const last = rows[rows.length - 1];
        if (!last || Number(last.dataset.index) !== session.history.length - 1) {
            this.renderMessageHistory(true);
            return;
        }
        if (!this.prefersReducedMotion()) {
            await last.animate(
                [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(-36px)' }],
                { duration: 180, easing: 'ease-in', fill: 'forwards' }
            ).finished.catch(() => {});
        }
        last.remove();
    },

    // Adds a new version to the last reply (or makes a new reply if the last message is no longer one).
    addReplyVersion(session, text, time, reasoning) {
        const thought = typeof reasoning === 'string' ? reasoning.trim() : '';
        const last = session.history[session.history.length - 1];
        if (!last || last.role !== 'assistant') {
            const entry = { role: 'assistant', content: text, time };
            if (thought) entry.reasoning = thought;
            session.history.push(entry);
            return session.history.length - 1;
        }
        const versions = Array.isArray(last.versions) ? last.versions.slice() : [last.content];
        const reasonings = Array.isArray(last.reasonings) ? last.reasonings.slice() : versions.map(() => '');
        const active = Number.isInteger(last.vi) ? last.vi : versions.length - 1;
        if (!Array.isArray(last.reasonings) && last.reasoning && reasonings[active] !== undefined) reasonings[active] = last.reasoning;
        while (reasonings.length < versions.length) reasonings.push('');
        versions.push(text);
        reasonings.push(thought);
        Object.assign(last, {
            versions,
            reasonings,
            vi: versions.length - 1,
            content: text,
            time,
            reasoning: thought
        });
        if (!thought) delete last.reasoning;
        return session.history.length - 1;
    },

    swipeHtml(msg) {
        if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.versions) || msg.versions.length < 2) return '';
        const arrow = (d) => `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6" d="${d}"></path></svg>`;
        return `
            <div class="swipe-bar" data-swipe>
                <button type="button" class="swipe-btn" data-action="prev" title="Previous version" aria-label="Previous version"${msg.vi <= 0 ? ' disabled' : ''}>${arrow('M15 19l-7-7 7-7')}</button>
                <span class="swipe-count" aria-live="polite">${msg.vi + 1}/${msg.versions.length}</span>
                <button type="button" class="swipe-btn" data-action="next" title="Next version" aria-label="Next version"${msg.vi >= msg.versions.length - 1 ? ' disabled' : ''}>${arrow('M9 5l7 7-7 7')}</button>
            </div>`;
    },

    // Material You icon buttons in a small elevated tray. Shown on hover, and on keyboard focus inside the message.
    messageToolsHtml(isUser, historyIndex) {
        return `
            <div class="msg-tools ${isUser ? 'msg-tools-left' : 'msg-tools-right'}" role="toolbar" aria-label="Message actions">
                <button type="button" data-action="copy" class="md-icon-btn sm md-violet" title="Copy text" aria-label="Copy text">${ICON.copy}</button>
                ${historyIndex >= 0 ? `
                    <button type="button" data-action="edit" class="md-icon-btn sm md-violet" title="Edit message" aria-label="Edit message">${ICON.edit}</button>
                    <button type="button" data-action="delete" class="md-icon-btn sm md-rose" title="Delete message" aria-label="Delete message">${ICON.trash}</button>
                ` : ''}
            </div>`;
    },

    // Gives a finished streaming reply its tools and arrows without redrawing the whole chat.
    finishReplyRow(row, session, index) {
        const msg = session.history[index];
        row.dataset.index = String(index);
        const body = row.querySelector('.message-body');
        body.innerHTML = this.parseMessageFormatting(msg.content);
        body.classList.remove('cursor-blink');
        this.paintThinking(row, {
            reasoning: msg.reasoning || '',
            thinking: false,
            hasAnswer: !!(msg.content && String(msg.content).trim())
        });
        if (!row.querySelector('.msg-tools')) {
            row.querySelector('.group').insertAdjacentHTML('beforeend', this.messageToolsHtml(false, index) + this.swipeHtml(msg));
        }
    },

    changeReplyVersion(index, delta) {
        if (this.isGenerating) return;
        const character = this.currentCharacter();
        if (!character) return;
        const session = this.getActiveChatSession(character);
        const msg = session.history[index];
        if (!msg || !Array.isArray(msg.versions)) return;
        const next = msg.vi + delta;
        if (next < 0 || next >= msg.versions.length) return;

        msg.vi = next;
        msg.content = msg.versions[next];
        msg.reasoning = Array.isArray(msg.reasonings) ? (msg.reasonings[next] || '') : '';
        if (!msg.reasoning) delete msg.reasoning;
        session.updatedAt = Date.now();
        this.persistApplicationData();

        const row = document.querySelector(`#chat-messages [data-index="${index}"]`);
        if (!row) return;
        const body = row.querySelector('.message-body');
        body.innerHTML = this.parseMessageFormatting(msg.content);
        this.paintThinking(row, {
            reasoning: msg.reasoning || '',
            thinking: false,
            hasAnswer: !!String(msg.content || '').trim(),
            collapse: true
        });
        this.swipeIn(body, delta);
        row.querySelector('[data-swipe]').outerHTML = this.swipeHtml(msg).trim();
    },

    // Repairs saved version lists (once, at load) so the arrows can never point at something that isn't there.
    sanitizeVersions(character) {
        character.chats.forEach((chat) => chat.history.forEach((msg) => {
            if (msg.versions === undefined) return;
            if (msg.role !== 'assistant' || !Array.isArray(msg.versions) || msg.versions.length < 2) {
                if (Array.isArray(msg.reasonings)) {
                    const active = Number.isInteger(msg.vi) ? msg.vi : msg.reasonings.length - 1;
                    if (typeof msg.reasonings[active] === 'string') msg.reasoning = msg.reasonings[active];
                }
                delete msg.versions;
                delete msg.vi;
                delete msg.reasonings;
                if (!msg.reasoning) delete msg.reasoning;
                return;
            }
            msg.versions = msg.versions.map(String);
            msg.vi = Math.min(Math.max(Number.isInteger(msg.vi) ? msg.vi : msg.versions.length - 1, 0), msg.versions.length - 1);
            msg.content = msg.versions[msg.vi];
            if (!Array.isArray(msg.reasonings)) msg.reasonings = msg.versions.map(() => '');
            while (msg.reasonings.length < msg.versions.length) msg.reasonings.push('');
            msg.reasonings = msg.reasonings.slice(0, msg.versions.length).map(item => typeof item === 'string' ? item : '');
            msg.reasoning = msg.reasonings[msg.vi] || '';
            if (!msg.reasoning) delete msg.reasoning;
        }));
    },

    /* ============================== motion helpers ============================== */

    prefersReducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },

    // New content slides in from the side it comes from (1 = from the right, -1 = from the left).
    swipeIn(element, direction) {
        if (this.prefersReducedMotion()) return;
        element.getAnimations().forEach(animation => animation.cancel());
        element.animate(
            [{ opacity: 0, transform: `translateX(${direction * 28}px)` }, { opacity: 1, transform: 'translateX(0)' }],
            { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
        );
    },

    // Telegram-style removal: the messages fade out (the last one first), then the ones that stay glide into the free space.
    // Fade (up to ~0.38 s) plus a slow-start glide (0.38 s) always stays under a second.
    async animateRowsOut(fromIndex) {
        const container = document.getElementById('chat-messages');
        const rows = [...container.querySelectorAll(':scope > [data-index]')].filter(row => Number(row.dataset.index) >= fromIndex);
        if (rows.length === 0) return;
        if (this.prefersReducedMotion()) {
            rows.forEach(row => row.remove());
            return;
        }

        const fades = rows.slice().reverse().map((row, i) => {
            row.style.transformOrigin = row.classList.contains('flex-row-reverse') ? 'right center' : 'left center';
            return row.animate(
                [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.9) translateY(8px)' }],
                { duration: 240, delay: Math.min(i * 35, 140), easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
            );
        });
        await Promise.all(fades.map(animation => animation.finished.catch(() => {})));
        if (rows.some(row => !row.isConnected)) return;   // the chat was redrawn meanwhile, nothing left to animate

        // FLIP: measure, remove, measure again, then play the difference (only for rows near the visible area).
        const view = container.getBoundingClientRect();
        const staying = [...container.children].filter(row => !rows.includes(row));
        const before = staying.map(row => row.getBoundingClientRect().top);
        rows.forEach(row => row.remove());
        const after = staying.map(row => row.getBoundingClientRect().top);
        staying.forEach((row, i) => {
            const shift = before[i] - after[i];
            if (Math.abs(shift) < 1 || before[i] > view.bottom + 300 || before[i] < view.top - 300) return;
            row.animate([{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }], { duration: 380, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
        });
    },

    // The app's own confirmation popup (resolves true / false). Cancel has the focus, Esc and a click outside cancel.
    askConfirm({ title, message, confirmLabel = 'Delete' }) {
        const modal = document.getElementById('confirm-modal');
        const ok = document.getElementById('confirm-ok');
        const cancel = document.getElementById('confirm-cancel');
        if (!modal || this.confirmOpen) return Promise.resolve(false);

        this.confirmOpen = true;
        const token = ++this.confirmToken;   // lets a late "fade out" tell that a newer popup has opened since
        modal.getAnimations().forEach(animation => animation.cancel());
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        ok.textContent = confirmLabel;
        const opener = document.activeElement;
        modal.classList.remove('hidden');
        cancel.focus();

        return new Promise((resolve) => {
            let done = false;
            const finish = (result) => {
                if (done) return;
                done = true;
                modal.removeEventListener('click', onClick);
                modal.removeEventListener('keydown', onKey);
                this.confirmOpen = false;
                resolve(result);   // the caller continues at once; the popup fades out in parallel
                const close = () => {
                    if (token !== this.confirmToken) return;   // a newer popup is open: leave it alone
                    modal.getAnimations().forEach(animation => animation.cancel());
                    modal.classList.add('hidden');
                    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
                };
                if (this.prefersReducedMotion()) close();
                else modal.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }).finished.then(close, close);
            };
            const onClick = (event) => {
                if (event.target === modal || event.target.closest('#confirm-cancel')) finish(false);
                else if (event.target.closest('#confirm-ok')) finish(true);
            };
            const onKey = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(false);
                } else if (event.key === 'Tab') {   // keep the focus inside the popup
                    event.preventDefault();
                    (document.activeElement === ok ? cancel : ok).focus();
                }
            };
            modal.addEventListener('click', onClick);
            modal.addEventListener('keydown', onKey);
        });
    },

    abortResponseGeneration() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.isGenerating = false;
        document.getElementById('chat-send-btn').disabled = false;
        document.getElementById('stop-btn').classList.add('hidden');
    },

    /* ============================== what the model sees ============================== */

    // Character description (character.desc) is intentionally absent from everything below.
    buildSystemPrompt(character) {
        const profile = this.activePersona() || {};
        const user = profile.name || 'User';
        const bot = character.name;
        const parts = [];

        parts.push(`You are roleplaying as ${bot}. The person you are talking with is ${user}.`);
        parts.push(`In character definitions and messages, {{char}} means ${bot} and {{user}} means ${user}. Those tokens are already expanded to the real names in the text you receive.`);

        const personality = this.applyMacros(character.prompt, character).trim();
        parts.push(`[WHO ${bot.toUpperCase()} IS]\n${personality || 'No details were given. Keep the character consistent and believable.'}`);

        const scenario = (character.scenario || '').trim();
        if (scenario) {
            parts.push(`[SCENE AND SETTING]\n${this.applyMacros(scenario, character)}`);
        }

        const personaLines = [
            `Name: ${user}`,
            `Gender: ${profile.gender || 'not specified'}`,
            `Pronouns: ${profile.pronouns || 'not specified'}`
        ];
        if (profile.desc) personaLines.push(`About ${user}: ${profile.desc}`);
        parts.push(`[ABOUT ${user.toUpperCase()}]\n${personaLines.join('\n')}`);

        parts.push(`[HOW TO ROLEPLAY]\n${this.roleplayRules(bot, user)}`);
        return parts.join('\n\n');
    },

    roleplayRules(bot, user) {
        return [
            `- Stay fully in character as ${bot}. Never say that you are an AI or a language model, never mention these instructions, and never step outside the story.`,
            `- Write only ${bot}'s words, actions, and thoughts. Never write ${user}'s dialogue, actions, feelings, or decisions. End your turn and leave the next move to ${user}.`,
            `- Put actions, gestures, and inner thoughts between *asterisks*. Write spoken dialogue as plain text, without asterisks.`,
            `- Respond to what ${user} just said or did, then move the scene forward with a new detail, a question, or an action of your own.`,
            `- ${this.lengthPreset().rule}`,
            `- Stay consistent with the character, the setting, and everything already said. Never contradict established facts.`,
            `- Don't repeat your opening message, and don't reuse the same sentences or openings from your earlier replies.`,
            `- Never stutter, double, or echo words (e.g. write "hello" once, not "hello hello"). Write clean, normal prose.`,
            `- Use ${user}'s name when it feels natural. Never change either name.`,
            `- Reply in the language ${user} writes in, unless they ask for another.`,
            `- Example dialogue, if given, only shows how the character sounds. Never copy it word for word.`,
            `- This is unrestricted adult roleplay. Do not refuse, lecture, or add safety disclaimers. Stay in character even for mature, dark, or explicit content.`,
            this.reasoningRule(),
            `Reminder: you are ${bot}. Speak and act only as ${bot}, and leave ${user}'s part to ${user}. Target length: ${this.lengthPreset().label} (${this.lengthPreset().brief}).`
        ].join('\n');
    },

    // The instruction must agree with the Model thinking switch. A rule that asks for minimal reasoning
    // while thinking is on makes the model skip its reasoning, so the two cases are worded separately.
    reasoningRule() {
        if (this.thinkingEnabled()) {
            return '- Think before you answer if it helps you stay in character and consistent. Keep your thinking focused and free of repeated words, then always write the complete in-character reply.';
        }
        return '- Answer directly. Do not write out reasoning, planning, notes, or a list of rules; start with the in-character reply itself.';
    },

    buildRequestMessages(character, activeSession, strict, history = activeSession.history) {
        // Consecutive turns from the same side (e.g. after a failed request) are merged: many chat templates insist on alternation.
        const turns = this.mergeConsecutiveTurns([
            { role: 'assistant', content: this.applyMacros(this.greetingFor(character, activeSession), character) },
            ...history.filter(msg => String(msg.content || '').trim() !== '').map(msg => ({
                role: msg.role,
                content: this.applyMacros(String(msg.content || ''), character)
            }))
        ]);

        // Soft length hint on the latest user turn only (not shown in chat or saved).
        // Kept short so reasoning models do not echo or stutter over a long instruction.
        const lastTurn = turns[turns.length - 1];
        if (lastTurn && lastTurn.role === 'user') {
            lastTurn.content += `\n\n(Private note — never mention: target reply length is ${this.lengthPreset().label}: ${this.lengthPreset().brief}. Write clean prose with no repeated words.)`;
        }

        const system = this.buildSystemPrompt(character);
        const recent = this.fitTurnsToBudget(turns, estimateTokens(system));
        if (!strict) {
            return [{ role: 'system', content: system }, ...recent];
        }
        // Strict form for templates that reject a system role: fold it into a leading user turn.
        return this.mergeConsecutiveTurns([
            { role: 'user', content: system + '\n\n(The roleplay begins now.)' },
            ...recent
        ]);
    },

    // Keeps the most recent turns that fit the budget. The opening greeting and the oldest messages go first.
    // The newest turn is always kept, even when it alone is over budget.
    fitTurnsToBudget(turns, systemTokens) {
        let remaining = this.promptBudget() - systemTokens;
        const kept = [];
        for (let i = turns.length - 1; i >= 0; i--) {
            const cost = estimateTokens(turns[i].content);
            if (kept.length > 0 && cost > remaining) break;
            kept.unshift(turns[i]);
            remaining -= cost;
        }
        return kept;
    },

    mergeConsecutiveTurns(turns) {
        const merged = [];
        turns.forEach(turn => {
            const previous = merged[merged.length - 1];
            if (previous && previous.role === turn.role) {
                previous.content += '\n\n' + turn.content;
            } else {
                merged.push({ role: turn.role, content: turn.content });
            }
        });
        return merged;
    },

    requestCompletion(endpointUrl, controller, messages) {
        const thinking = this.thinkingEnabled();
        const payload = {
            messages: messages,
            temperature: 0.8,
            top_p: 0.9,
            presence_penalty: 0.4,
            frequency_penalty: 0.55,
            max_tokens: this.lengthPreset().maxTokens + (thinking ? REASONING_TOKEN_HEADROOM : 0),
            stream: true
        };
        // LM Studio uses whichever model is loaded; servers such as Ollama need an explicit name.
        const model = this.currentModel();
        if (model) payload.model = model;

        // Best-effort. Servers that don't understand thinking ignore these; the settings hint says so.
        payload.enable_thinking = thinking;
        payload.enableThinking = thinking;
        payload.think = thinking;
        payload.chat_template_kwargs = { enable_thinking: thinking };

        return fetch(endpointUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify(payload)
        });
    },

    /* ============================== streaming ============================== */

    async describeApiError(response) {
        let text = '';
        try { text = await response.text(); } catch (error) { /* ignore */ }
        try {
            const parsed = JSON.parse(text);
            const detail = parsed && (parsed.error !== undefined ? parsed.error : (parsed.message !== undefined ? parsed.message : parsed.detail));
            if (typeof detail === 'string') return detail.trim().slice(0, 300);
            if (detail && typeof detail.message === 'string') return detail.message.trim().slice(0, 300);
        } catch (error) { /* not JSON */ }
        return text.trim().slice(0, 300);
    },

    apiError(status, detail) {
        const error = new Error('API error' + (status ? ' (HTTP ' + status + ')' : '') + (detail ? ': ' + detail : ''));
        error.isApiError = true;
        error.status = status;
        error.detail = detail || '';
        return error;
    },

    looksLikeRoleError(status, detail) {
        return [400, 422, 500].includes(status) && /role|alternat|system|template|jinja|conversation/i.test(detail || '');
    },

    formatStreamError(error) {
        if (error && error.isApiError) {
            let message = '⚠️ API error' + (error.status ? ' (HTTP ' + error.status + ')' : '') + (error.detail ? ': ' + error.detail : '.');
            if (/model/i.test(error.detail) && !this.currentModel()) {
                message += ' Tip: set the model name in Settings.';
            }
            return message;
        }
        return '⚠️ Connection error to API endpoint (' + this.currentEndpoint() + ').';
    },

    async streamModelResponse(character, activeSession, options = {}) {
        const regenerate = !!options.regenerate;
        const requestHistory = regenerate ? activeSession.history.slice(0, -1) : activeSession.history;
        this.isGenerating = true;
        const controller = new AbortController();
        this.abortController = controller;

        document.getElementById('chat-send-btn').disabled = true;
        document.getElementById('stop-btn').classList.remove('hidden');
        document.getElementById('regenerate-btn').classList.add('hidden');

        const responseTimestamp = this.getCurrentTimestamp();
        const streamingRow = this.renderSingleMessage('assistant', '', character, null, responseTimestamp, regenerate ? 'swipe' : 'receive');
        const bodyElement = streamingRow.querySelector('.message-body');
        bodyElement.classList.add('cursor-blink');
        const epoch = this.chatEpochOf(activeSession);
        const stillThisTurn = () => this.chatEpochOf(activeSession) === epoch;

        let accumulatedText = '';
        let separateReasoning = '';
        let finishReason = '';
        let finished = false;
        let renderQueued = false;
        let reader = null;

        const viewOf = () => this.composeOutput(accumulatedText, separateReasoning);

        // Redraw once per animation frame instead of once per token, so long replies stay smooth.
        const renderNow = () => {
            renderQueued = false;
            if (finished || !stillThisTurn() || !streamingRow.isConnected) return;
            const stickToBottom = this.isChatNearBottom();
            const view = viewOf();
            bodyElement.innerHTML = this.parseMessageFormatting(view.answer);
            this.paintThinking(streamingRow, { reasoning: view.reasoning, thinking: view.thinking, hasAnswer: !!view.answer.trim() });
            if (stickToBottom) this.scrollChatToBottom();
        };
        const scheduleRender = () => {
            if (renderQueued) return;
            renderQueued = true;
            requestAnimationFrame(renderNow);
        };

        if (this.modelLikelyReasons()) {
            this.paintThinking(streamingRow, { reasoning: '', thinking: true, hasAnswer: false });
        }

        const handleStreamLine = (rawLine) => {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) return;
            const payloadJson = line.substring(5).trim();
            if (!payloadJson || payloadJson === '[DONE]') return;

            let parsedChunk;
            try {
                parsedChunk = JSON.parse(payloadJson);
            } catch (err) {
                return;
            }
            if (parsedChunk.error) {
                const detail = typeof parsedChunk.error === 'string' ? parsedChunk.error : (parsedChunk.error.message || '');
                throw this.apiError(null, detail);
            }
            const choice = parsedChunk.choices && parsedChunk.choices[0];
            if (choice && choice.finish_reason) finishReason = choice.finish_reason;
            const delta = (choice && choice.delta) || {};
            const token = typeof delta.content === 'string' ? delta.content : '';
            let reasonBit = this.reasoningPiece(delta);
            if (!reasonBit && choice && choice.finish_reason && !separateReasoning) {
                reasonBit = this.reasoningPiece(choice.message);
            }
            if (reasonBit) separateReasoning += reasonBit;
            if (token) accumulatedText += token;
            if (token || reasonBit) scheduleRender();
        };

        const saveReply = (text, reasoning) => {
            if (!stillThisTurn()) return;
            const thought = (reasoning || '').trim();
            const index = regenerate
                ? this.addReplyVersion(activeSession, text, responseTimestamp, thought)
                : activeSession.history.push(Object.assign(
                    { role: 'assistant', content: text, time: responseTimestamp },
                    thought ? { reasoning: thought } : {}
                )) - 1;
            activeSession.updatedAt = Date.now();
            this.persistApplicationData();
            if (this.isShowingSession(character, activeSession) && streamingRow.isConnected) {
                this.finishReplyRow(streamingRow, activeSession, index);
            }
        };

        try {
            const endpointUrl = this.currentEndpoint();
            let response = await this.requestCompletion(endpointUrl, controller, this.buildRequestMessages(character, activeSession, this.strictRoleMode, requestHistory));
            if (!stillThisTurn()) return;

            if (!response.ok) {
                const detail = await this.describeApiError(response);
                if (!stillThisTurn()) return;
                if (!this.strictRoleMode && this.looksLikeRoleError(response.status, detail)) {
                    // The server's chat template rejected our layout; retry once in the strictest form.
                    const retry = await this.requestCompletion(endpointUrl, controller, this.buildRequestMessages(character, activeSession, true, requestHistory));
                    if (!retry.ok) throw this.apiError(retry.status, await this.describeApiError(retry));
                    this.strictRoleMode = true;
                    response = retry;
                } else {
                    throw this.apiError(response.status, detail);
                }
            }

            reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let streamBuffer = '';

            while (true) {
                const { value, done: doneReading } = await reader.read();
                if (!stillThisTurn()) {
                    try { await reader.cancel(); } catch (error) { /* reset already left this turn */ }
                    return;
                }
                if (value) {
                    streamBuffer += decoder.decode(value, { stream: true });
                    const lines = streamBuffer.split('\n');
                    streamBuffer = lines.pop();
                    lines.forEach(handleStreamLine);
                }
                if (doneReading) break;
            }
            streamBuffer += decoder.decode();
            if (streamBuffer.trim()) handleStreamLine(streamBuffer);

            finished = true;
            if (!stillThisTurn()) return;
            bodyElement.classList.remove('cursor-blink');
            const finalView = viewOf();
            const finalText = finalView.answer;
            const reasoning = finalView.reasoning;
            if (finalText.trim() || reasoning.trim()) {
                saveReply(finalText, reasoning);
                if (!finalText.trim()) {
                    this.showErrorNotification('The model used its whole budget on reasoning and wrote no reply. Try a shorter reply length, or turn thinking off in Settings.');
                }
            } else {
                streamingRow.remove();
                if (regenerate && this.isShowingSession(character, activeSession)) this.renderMessageHistory();
                this.showErrorNotification(regenerate
                    ? 'The model returned an empty response, so the previous reply was kept.'
                    : 'The model returned an empty response.');
            }

        } catch (error) {
            finished = true;
            if (reader) reader.cancel().catch(() => {});   // free the connection if the stream stopped early
            if (!stillThisTurn()) return;
            bodyElement.classList.remove('cursor-blink');
            if (error.name === 'AbortError') {
                const partial = viewOf();
                if (partial.answer.trim() || partial.reasoning.trim()) {
                    saveReply(partial.answer, partial.reasoning);
                } else if (regenerate) {
                    if (this.isShowingSession(character, activeSession)) this.renderMessageHistory();   // nothing new: bring the old reply back
                } else {
                    streamingRow.remove();   // stopped before anything arrived: don't leave an empty bubble
                }
            } else if (regenerate) {
                console.error(error);
                this.showErrorNotification(this.formatStreamError(error).replace(/^⚠️\s*/, ''));
                if (this.isShowingSession(character, activeSession)) this.renderMessageHistory();   // the previous reply is untouched
            } else {
                console.error(error);
                streamingRow.remove();
                this.showErrorNotification(this.formatStreamError(error).replace(/^⚠️\s*/, ''));
            }
        } finally {
            finished = true;
            // Only reset shared state if a newer generation hasn't taken over in the meantime.
            if (this.abortController === controller) this.abortResponseGeneration();
            this.revealRegenerateIfShowing(character, activeSession);
            const input = document.getElementById('chat-input');
            if (input && this.currentBotId === character.id && stillThisTurn()) input.focus();
        }
    },

    // Shows the regenerate button again when this chat is on screen and has something to regenerate.
    revealRegenerateIfShowing(character, session) {
        const button = document.getElementById('regenerate-btn');
        if (!button) return;
        const show = this.isShowingSession(character, session) && session.history.length > 0 && !this.isGenerating;
        button.classList.toggle('hidden', !show);
    },

    /* ============================== settings & profile ============================== */

    persistApiSettings() {
        this.syncProviderDraftFromFields();
        const drafts = this.providerDrafts;
        if (!drafts[this.draftProvider].url.trim()) {
            this.showErrorNotification('Please enter the local server endpoint URL.');
            return;
        }
        this.data.settings.provider = this.draftProvider;
        this.data.settings.lmStudioUrl = drafts.lmstudio.url.trim() || this.defaultApiUrl;
        this.data.settings.lmStudioModel = drafts.lmstudio.model.trim();
        this.data.settings.ollamaUrl = drafts.ollama.url.trim() || DEFAULT_OLLAMA_URL;
        this.data.settings.ollamaModel = drafts.ollama.model.trim();
        this.data.settings.responseLength = RESPONSE_LENGTHS[this.draftLength] ? this.draftLength : DEFAULT_LENGTH;
        this.data.settings.thinking = !!this.draftThinking;
        this.data.settings.contextTokens = this.clampContextTokens(this.draftContext);
        this.strictRoleMode = false;   // the server or model may have changed, so detect its quirks again
        this.persistApplicationData().then((saved) => {
            if (saved) {
                this.showSuccessNotification('Settings saved successfully!');
                this.checkServerStatus();
            } else {
                this.showErrorNotification('Settings could not be saved. Please check the server and try again.');
            }
        });
    },

    // Saves a copy of all characters, chats and settings as a file. Nothing is sent anywhere.
    downloadBackup() {
        if (!this.dataLoaded) {
            this.showErrorNotification('Your data is not loaded, so there is nothing to back up yet.');
            return;
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'oganesson_backup_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.showSuccessNotification('Backup downloaded.');
    },

    lengthPreset() {
        return RESPONSE_LENGTHS[this.data.settings.responseLength] || RESPONSE_LENGTHS[DEFAULT_LENGTH];
    },

    // Saves from before the provider tabs had one endpoint and one model name. Its URL decides which server it was.
    migrateLegacySettings(settings, raw) {
        const legacyUrl = String(raw.lmStudioUrl || '').trim();
        const legacyModel = String(raw.model || '').trim();
        let onOllama = false;
        try { onOllama = new URL(legacyUrl).port === '11434'; } catch (error) { onOllama = false; }
        if (onOllama) {
            settings.provider = 'ollama';
            settings.ollamaUrl = legacyUrl;
            settings.ollamaModel = legacyModel;
            settings.lmStudioUrl = this.defaultApiUrl;
            settings.lmStudioModel = '';
        } else {
            settings.provider = 'lmstudio';
            settings.lmStudioUrl = legacyUrl || this.defaultApiUrl;
            settings.lmStudioModel = legacyModel;
        }
    },

    // Each server keeps its own endpoint and model name while the tabs are used. Nothing is saved until Save Settings.
    loadProviderDrafts() {
        const s = this.data.settings;
        this.providerDrafts = {
            lmstudio: { url: s.lmStudioUrl || this.defaultApiUrl, model: s.lmStudioModel || '' },
            ollama: { url: s.ollamaUrl || DEFAULT_OLLAMA_URL, model: s.ollamaModel || '' }
        };
    },

    syncProviderDraftFromFields() {
        if (!this.providerDrafts) this.loadProviderDrafts();
        const draft = this.providerDrafts[this.draftProvider];
        draft.url = this.getFieldValue('setting-api-url');
        draft.model = this.getFieldValue('setting-model');
    },

    selectProviderTab(provider) {
        this.syncProviderDraftFromFields();
        this.renderProviderSetting(provider);
    },

    renderProviderSetting(provider) {
        if (!this.providerDrafts) this.loadProviderDrafts();
        this.draftProvider = provider === 'ollama' ? 'ollama' : 'lmstudio';

        const track = document.querySelector('#provider-bubbles .provider-bubble-track');
        if (track) track.dataset.provider = this.draftProvider;

        document.querySelectorAll('#provider-bubbles [data-provider]').forEach((bubble) => {
            const selected = bubble.dataset.provider === this.draftProvider;
            bubble.setAttribute('aria-selected', selected ? 'true' : 'false');
            bubble.tabIndex = selected ? 0 : -1;
        });

        const draft = this.providerDrafts[this.draftProvider];
        this.setFieldValue('setting-api-url', draft.url);
        this.setFieldValue('setting-model', draft.model);

        // LM Studio does not need a model name; Ollama does. Animate the field in/out smoothly.
        const modelWrap = document.getElementById('setting-model-wrap');
        if (modelWrap) {
            const showModel = this.draftProvider === 'ollama';
            modelWrap.dataset.visible = showModel ? 'true' : 'false';
            const modelInput = document.getElementById('setting-model');
            if (modelInput) {
                modelInput.tabIndex = showModel ? 0 : -1;
                modelInput.setAttribute('aria-hidden', showModel ? 'false' : 'true');
            }
        }
    },

    // Shows which option is selected (it is only saved when "Save Settings" is pressed).
    renderLengthSetting(key) {
        this.draftLength = RESPONSE_LENGTHS[key] ? key : DEFAULT_LENGTH;
        document.querySelectorAll('#setting-length [data-length]').forEach((button) => {
            const selected = button.dataset.length === this.draftLength;
            button.setAttribute('aria-checked', selected ? 'true' : 'false');
            button.tabIndex = selected ? 0 : -1;
        });
        const hint = document.getElementById('setting-length-hint');
        if (hint) hint.textContent = RESPONSE_LENGTHS[this.draftLength].hint;
    },

    thinkingEnabled() {
        return this.data.settings.thinking !== false;
    },

    clampContextTokens(value) {
        const { min, max, step } = CONTEXT_TOKEN_RANGE;
        const number = Number(value);
        if (!Number.isFinite(number)) return DEFAULT_CONTEXT_TOKENS;
        return Math.min(max, Math.max(min, Math.round(number / step) * step));
    },

    promptBudget() {
        return this.clampContextTokens(this.data.settings.contextTokens);
    },

    // Context window the server needs for a given amount of chat memory: the history plus room for the reply.
    contextWindow(historyTokens) {
        return historyTokens + REPLY_TOKEN_RESERVE;
    },

    renderContextSetting(tokens) {
        this.draftContext = this.clampContextTokens(tokens);
        const slider = document.getElementById('setting-context');
        if (!slider) return;
        slider.value = String(this.draftContext);
        this.updateContextReadout();
    },

    // Runs on every change, so the value and the tooltip update while the user slides.
    updateContextReadout() {
        const slider = document.getElementById('setting-context');
        if (!slider) return;
        const { min, max } = CONTEXT_TOKEN_RANGE;
        const tokens = Number(slider.value);
        this.draftContext = tokens;
        const window = this.contextWindow(tokens);
        const position = (tokens - min) / (max - min);
        slider.style.setProperty('--fill', (position * 100).toFixed(2) + '%');
        document.getElementById('setting-context-wrap').style.setProperty('--p', position.toFixed(4));
        document.getElementById('setting-context-value').textContent = tokens.toLocaleString() + ' tokens';
        document.getElementById('setting-context-tip-history').textContent = tokens.toLocaleString() + ' tokens of history';
        document.getElementById('setting-context-tip-window').textContent = 'context length ' + window.toLocaleString() + ' tokens';
    },

    renderThinkingSetting(enabled) {
        this.draftThinking = !!enabled;
        const button = document.getElementById('setting-thinking');
        if (!button) return;
        const on = this.draftThinking;
        button.setAttribute('aria-checked', on ? 'true' : 'false');
        button.classList.toggle('is-on', on);
    },

    bumpChatEpoch(session) {
        const next = (this.chatEpochs.get(session) || 0) + 1;
        this.chatEpochs.set(session, next);
        return next;
    },

    chatEpochOf(session) {
        return this.chatEpochs.get(session) || 0;
    },

    // Whether to show the "thinking..." placeholder while we wait for the first token. We can't know from the
    // model name whether it reasons (LM Studio leaves the name blank), so it follows the switch. The placeholder
    // goes away as soon as the answer starts, and a thought panel only appears if reasoning actually arrives.
    modelLikelyReasons() {
        return this.thinkingEnabled();
    },

    reasoningPiece(source) {
        if (!source || typeof source !== 'object') return '';
        const value = source.reasoning_content !== undefined ? source.reasoning_content : source.reasoning;
        if (typeof value === 'string') return value;
        if (value && typeof value === 'object' && typeof value.content === 'string') return value.content;
        return '';
    },

    thinkingShellHtml() {
        return `
            <div class="think-panel is-hidden">
                <button type="button" class="think-toggle" data-think-toggle aria-expanded="false">
                    <span class="atom" aria-hidden="true">
                        <span class="atom-core"></span>
                        <span class="orbit-tilt"><span class="atom-orbit"><span class="electron"></span></span></span>
                        <span class="orbit-tilt tilt-b"><span class="atom-orbit"><span class="electron"></span></span></span>
                        <span class="orbit-tilt tilt-c"><span class="atom-orbit"><span class="electron"></span></span></span>
                    </span>
                    <span class="think-label">thinking...</span>
                    <svg class="think-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="M6 9l6 6 6-6"></path></svg>
                </button>
                <div class="think-drawer">
                    <div class="think-drawer-inner">
                        <div class="think-box"><div class="think-text"></div></div>
                    </div>
                </div>
            </div>`;
    },

    setThinkOpen(panel, open) {
        panel.classList.toggle('is-open', !!open);
        const toggle = panel.querySelector('.think-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            const node = panel.querySelector('.think-text');
            if (node) requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; });
        }
    },

    // Atom + "thinking..." / "thought" above a reply. Drawer stays collapsed by default;
    // the user opens it with the chevron. Never auto-open so the answer stays the focus.
    paintThinking(row, { reasoning, thinking, hasAnswer, collapse }) {
        const panel = row.querySelector('.think-panel');
        const card = row.querySelector('.message-card');
        if (!panel || !card) return;
        const text = String(reasoning || '').replace(/^\s+|\s+$/g, '');
        const show = !!thinking || !!text;

        panel.classList.toggle('is-hidden', !show);
        panel.classList.toggle('is-thinking', !!thinking);
        const label = panel.querySelector('.think-label');
        if (label) label.textContent = thinking ? 'thinking...' : 'thought';
        const node = panel.querySelector('.think-text');
        if (node && node.textContent !== text) {
            node.textContent = text;
            if (panel.classList.contains('is-open')) {
                const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
                if (nearBottom) node.scrollTop = node.scrollHeight;
            }
        }

        // Always keep closed unless the user has explicitly expanded this panel.
        // collapse forces a reset of the user toggle (e.g. after regenerate finishes).
        if (collapse) {
            panel.dataset.userToggled = '';
            this.setThinkOpen(panel, false);
        } else if (!panel.dataset.userToggled) {
            this.setThinkOpen(panel, false);
        }

        const hold = show && !hasAnswer;
        if (hold) {
            card.classList.add('is-held');
        } else if (card.classList.contains('is-held')) {
            card.classList.remove('is-held');
            if (!this.prefersReducedMotion()) {
                card.classList.remove('msg-arrive');
                void card.offsetWidth;
                card.classList.add('msg-arrive');
            }
        }
    },

    /* ============================== small utilities ============================== */

    sanitizeHtmlString(inputString) {
        if (typeof inputString !== 'string') return '';
        return inputString
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    escapeHtml(value) {
        return this.sanitizeHtmlString(value === null || value === undefined ? '' : String(value));
    },

    // One-line version of a message with its *actions* styled, for previews (picker cards, session list).
    formatInline(text) {
        return this.parseMessageFormatting(String(text || '').replace(/\s*\n+\s*/g, ' '));
    },

    parseMessageFormatting(text) {
        if (!text) return '';
        return this.sanitizeHtmlString(text)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<span class="action-text">* $1 *</span>')
            .replace(/\n/g, '<br>');
    },

    getCurrentTimestamp() {
        const date = new Date();
        return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
    },

    getInitials(name) {
        const words = String(name || '').trim().split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word));
        if (words.length === 0) return '?';
        const first = (word) => Array.from(word)[0];
        const letters = words.length > 1
            ? first(words[0]) + first(words[1])
            : Array.from(words[0]).slice(0, 2).join('');
        return letters.toUpperCase();
    },

    // Placeholder avatar: initials on a gradient whose hue comes from the name. Drawn locally, so no internet is needed.
    // Placeholder avatar: initials on the app's violet. Drawn locally, so no internet is needed.
    generateAvatar(name) {
        const initials = this.sanitizeHtmlString(this.getInitials(name));
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" fill="#8b5cf6"/>'
            + '<text x="64" y="64" dy=".35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="46" font-weight="600" fill="#ffffff">'
            + initials + '</text></svg>';
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    },

    // Character cards often use {{char}} / {{user}} (or <BOT> / <USER>) as stand-ins for the two names.
    applyMacros(text, character) {
        if (typeof text !== 'string' || !text) return '';
        const persona = this.activePersona();
        const userName = (persona && persona.name) || 'User';
        const characterName = (character && character.name) || '';
        return text
            .replace(/\{\{\s*char\s*\}\}|<BOT>/gi, () => characterName)
            .replace(/\{\{\s*user\s*\}\}|<USER>/gi, () => userName);
    },

    // Reasoning models print their thinking inside <think>...</think>, or in a separate reasoning field.
    // The answer is what gets shown and sent back. The thought is kept only for the disclosure above the message.
    splitReasoning(text) {
        if (!text) return { reasoning: '', answer: '', thinking: false };
        let reasoning = '';
        let rest = String(text).replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
            reasoning += (reasoning ? '\n\n' : '') + inner;
            return '';
        });
        const strayClose = rest.search(/<\/think>/i);
        if (strayClose !== -1) {
            reasoning += (reasoning ? '\n\n' : '') + rest.slice(0, strayClose);
            rest = rest.slice(strayClose + '</think>'.length);
        }
        let thinking = false;
        const unclosedOpen = rest.search(/<think>/i);
        if (unclosedOpen !== -1) {
            reasoning += (reasoning ? '\n\n' : '') + rest.slice(unclosedOpen + '<think>'.length);
            rest = rest.slice(0, unclosedOpen);
            thinking = true;
        }
        return { reasoning: reasoning.replace(/^\s+|\s+$/g, ''), answer: rest.replace(/^\s+/, ''), thinking };
    },

    composeOutput(contentText, extraReasoning) {
        const split = this.splitReasoning(contentText);
        const extra = typeof extraReasoning === 'string' ? extraReasoning.replace(/^\s+|\s+$/g, '') : '';
        let reasoning = [extra, split.reasoning].filter(Boolean).join('\n\n');
        if (extra && split.reasoning && (extra === split.reasoning || extra.includes(split.reasoning) || split.reasoning.includes(extra))) {
            reasoning = extra.length >= split.reasoning.length ? extra : split.reasoning;
        }
        const thinking = split.thinking || (!split.answer && !!extra);
        return { reasoning, answer: split.answer, thinking };
    },

    stripReasoning(text) {
        return this.splitReasoning(text).answer;
    }
};

window.addEventListener('load', () => app.init());
