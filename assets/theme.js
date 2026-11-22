(() => {
    'use strict';
    const key = 'dms.theme';
    const themes = new Set(['glassy', 'light', 'dark']);
    let theme = 'glassy';

    function apply(value) {
        theme = themes.has(value) ? value : 'glassy';
        document.documentElement.dataset.dmsTheme = theme;
        document.querySelectorAll('[data-dms-theme-picker]').forEach(select => {
            select.value = theme;
        });
    }

    try { theme = localStorage.getItem(key); } catch (_) {}
    apply(theme);
    document.addEventListener('DOMContentLoaded', () => apply(theme), { once: true });
    document.addEventListener('change', event => {
        const select = event.target;
        if (!select.matches('[data-dms-theme-picker]')) return;
        apply(select.value);
        try { localStorage.setItem(key, theme); } catch (_) {}
    });
    window.addEventListener('storage', event => {
        if (event.key === key) apply(event.newValue);
    });
})();
