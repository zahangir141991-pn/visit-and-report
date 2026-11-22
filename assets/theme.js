(() => {
    'use strict';
    const lastKey = 'dms.theme';
    const prefix = 'dms.theme.user.';
    const themes = new Set(['glassy', 'light', 'dark']);
    let user = '';
    let previewUser = '';
    const root = document.documentElement;
    let theme = 'glassy';

    function read(key) {
        try { return localStorage.getItem(key); } catch (_) { return null; }
    }

    function write(key, value) {
        try { localStorage.setItem(key, value); } catch (_) {}
    }

    function syncPickers() {
        document.querySelectorAll('[data-dms-theme-picker]').forEach(select => {
            if (select.value !== theme) select.value = theme;
        });
    }

    function apply(value) {
        const next = themes.has(value) ? value : 'glassy';
        if (root.dataset.dmsTheme === next) return;
        theme = next;
        root.dataset.dmsTheme = theme;
        if (document.readyState !== 'loading') syncPickers();
        const frame = document.getElementById('dms-attendance-frame');
        if (frame?.hasAttribute('src')) frame.contentWindow?.DmsTheme?.reflect(theme);
    }

    function embeddedTheme() {
        if (window.parent === window) return null;
        try { return window.parent.document.documentElement.dataset.dmsTheme; }
        catch (_) { return null; }
    }

    function signIn(id) {
        user = id;
        previewUser = '';
        apply(read(prefix + id));
        write(lastKey, theme);
    }

    function preview(id) {
        if (user) return;
        previewUser = id;
        apply(id ? read(prefix + id) : read(lastKey));
    }

    function signOut() {
        user = '';
        previewUser = '';
    }

    apply(embeddedTheme() || read(lastKey));
    window.DmsTheme = { signIn, preview, signOut, reflect: apply };
    document.addEventListener('DOMContentLoaded', syncPickers, { once: true });
    document.addEventListener('change', event => {
        const select = event.target;
        if (!user || !select.matches('[data-dms-theme-picker]')) return;
        apply(select.value);
        write(prefix + user, theme);
        write(lastKey, theme);
    });
    window.addEventListener('storage', event => {
        if (embeddedTheme()) return;
        const id = user || previewUser;
        if (event.key === (id ? prefix + id : lastKey)) apply(event.newValue);
    });
})();
