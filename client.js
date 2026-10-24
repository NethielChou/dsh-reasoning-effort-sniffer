/**
 * Browser half of `dsh-reasoning-effort-sniffer`.
 *
 * The panel is deliberately one thing only: per third-party provider, two
 * switches.
 *   - 思考强度 — declare levels for this provider's models. Off removes the
 *     declarations, so the model picker stops offering a strength choice there.
 *   - 嗅探 — decide the levels by probing the endpoint. Off declares the full
 *     level set without any network request (for gateways you already know).
 *
 * Choosing a strength is not this panel's job: that happens in the composer's
 * own model picker, exactly like the official DeepSeek provider. The switches are
 * stored in this plugin's config, so they survive restarts and the host applies
 * them within a second (volatile update → immediate pass).
 */
window.__ModuleLoader__.load({
  id: 'dsh-reasoning-effort-sniffer',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;

    /** Locale namespace owned by this module. */
    const NS = 'reasoning-effort';
    /** This plugin's config namespace; its entry id is the bundle row id. */
    const POLICY_NS = 'reasoning-effort';
    /** The pi-ai adapter's settings namespace (read-only here: provider list). */
    const PROVIDERS_NS = 'llm-pi-ai';
    /** Stylesheet identity, so a second mount adds no duplicate tag. */
    const CSS_TAG_ID = 'dsh-reasoning-effort-sniffer/panel.css';

    const zh = {
      title: '思考强度',
      action: '思考强度',
      hint: '按供应商开关。强度切换本身在输入框右下角的模型选择器里进行。',
      provider: '供应商',
      reasoning: '思考强度',
      sniff: '嗅探',
      reasoningOn: '已开启：模型选择器可切强度',
      reasoningOff: '已关闭：该供应商不提供强度',
      sniffOn: '开启：自动探测端点支持哪些档位',
      sniffOff: '关闭：直接按全档声明，不探测',
      loading: '读取中…',
      unavailable: '当前连接不可写',
      empty: '还没有第三方供应商',
      close: '关闭',
      policyUnavailable: '开关配置不可用，只能读取现状',
      saveFailed: '保存失败，已刷新为服务端当前值',
    };
    const en = {
      title: 'Reasoning effort',
      action: 'Reasoning effort',
      hint: 'One row per provider. Picking a strength happens in the composer model picker.',
      provider: 'Provider',
      reasoning: 'Strength',
      sniff: 'Sniff',
      reasoningOn: 'On: the model picker offers a strength switch',
      reasoningOff: 'Off: this provider offers no strength switch',
      sniffOn: 'On: probe which levels the endpoint accepts',
      sniffOff: 'Off: declare all levels without probing',
      loading: 'Loading…',
      unavailable: 'Not writable on this connection',
      empty: 'No third-party providers yet',
      close: 'Close',
      policyUnavailable: 'Switches are not editable on this connection',
      saveFailed: 'Save failed; the stored value was reloaded',
    };

    const CSS = [
      '.re_layer{box-sizing:border-box;flex:none;width:calc(100% + 4px);height:42px;margin:4px -2px;display:flex;position:relative}',
      '.re_layer.re_rail{width:36px;height:36px;margin:0}',
      '.re_action{box-sizing:border-box;width:100%;height:42px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;display:inline-flex;align-items:center;gap:8px;padding:0 10px 0 8px;font-family:inherit;font-size:14px;overflow:hidden}',
      '.re_action:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.re_action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.re_rail .re_action{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;padding:0}',
      '.re_icon{flex:none;display:inline-flex}',
      '.re_label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.re_panel{z-index:100;box-sizing:border-box;position:fixed;bottom:128px;left:12px;width:380px;max-width:calc(100vw - 24px);max-height:70vh;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base)));backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent,var(--dsw-shadow-lv2));border-radius:12px;overflow:hidden}',
      '.re_header{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.re_title{font-size:13px;font-weight:500;line-height:20px}',
      '.re_close{cursor:pointer;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;padding:0;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:6px;font:inherit}',
      '.re_close:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.re_body{flex:1;min-height:0;display:flex;flex-direction:column;gap:2px;padding:6px 12px 12px;overflow-y:auto}',
      '.re_hint{margin:4px 0 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.re_headRow{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.re_headRow>.re_headName{flex:1;min-width:0}',
      '.re_toggleHead{width:44px;text-align:center;flex:none}',
      '.re_row{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px dashed var(--dsw-alias-border-l2)}',
      '.re_name{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.re_nameText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace;font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.re_note{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary)}',
      '.re_switchWrap{flex:none;width:44px;display:flex;justify-content:center}',
      '.re_switch{position:relative;width:34px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l2,transparent);cursor:pointer;padding:0;transition:background .15s ease}',
      '.re_switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary,#1f6feb);border-color:transparent}',
      '.re_switch:disabled{cursor:not-allowed;opacity:.5}',
      '.re_knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .15s ease}',
      '.re_switch[aria-checked="true"] .re_knob{transform:translateX(14px)}',
      '.re_error{margin:4px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary)}',
    ].join('');

    /** Add this module's stylesheet once per page. */
    function installStyles() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']') !== null) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-reasoning-effort-sniffer';
      tag.dataset.pluginCss = CSS_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** The gauge glyph used as the sidebar action's icon. */
    function GaugeIcon() {
      return h('svg', {
        className: 're_icon', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
      h('path', { d: 'M2.5 11.5a5.5 5.5 0 1 1 11 0', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      h('path', { d: 'M8 8.5 10.5 6', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      h('circle', { cx: 8, cy: 8.5, r: 1.2, fill: 'currentColor' }));
    }

    /**
     * The sidebar action and its provider-switch panel.
     * @param props - `wide` from the sidebar shell, `t` bound by the slot runtime,
     *   and the two settings forms (policy = writable, providers = read-only).
     * @returns the sidebar footer action contribution.
     */
    function ReasoningAction({ wide, t, policy, providers }) {
      const [open, setOpen] = React.useState(false);
      const layerRef = React.useRef(null);
      const panelRef = React.useRef(null);

      // Close like a utility popover: Escape or a pointerdown outside both the
      // action and the portaled panel. Capture phase because the panel lives in
      // document.body, outside this subtree.
      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
          if (path.includes(layerRef.current) || path.includes(panelRef.current)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
        };
      }, [open]);

      return h('div', { ref: layerRef, className: wide ? 're_layer' : 're_layer re_rail' },
        open ? createPortal(h('section', {
          ref: panelRef,
          className: 're_panel',
          'data-reasoning-effort-panel': true,
          'aria-label': t('title'),
        },
        h('header', { className: 're_header' },
          h('span', { className: 're_title' }, t('title')),
          h('button', { type: 'button', className: 're_close', 'aria-label': t('close'), onClick: () => setOpen(false) }, '✕')),
        h(Panel, { t, policy, providers })), document.body) : null,
        h('button', {
          type: 'button',
          className: 're_action',
          title: t('action'),
          'aria-label': t('action'),
          onClick: () => setOpen((current) => !current),
        },
        h(GaugeIcon),
        wide ? h('span', { className: 're_label' }, t('action')) : null));
    }

    /**
     * Provider rows with two switches each. The provider list is read from the
     * pi-ai form; the switch values live in this plugin's own form.
     * @param props - copy function and the two settings forms.
     * @returns the panel body.
     */
    function Panel({ t, policy, providers }) {
      const subscribePolicy = React.useCallback((notify) => policy.subscribe(notify), [policy]);
      const snapshotPolicy = React.useCallback(() => policy.getSnapshot(), [policy]);
      const subscribeProviders = React.useCallback((notify) => providers.subscribe(notify), [providers]);
      const snapshotProviders = React.useCallback(() => providers.getSnapshot(), [providers]);
      const policySnap = React.useSyncExternalStore(subscribePolicy, snapshotPolicy);
      const providersSnap = React.useSyncExternalStore(subscribeProviders, snapshotProviders);
      const [error, setError] = React.useState(null);
      const [busy, setBusy] = React.useState(null);

      try {
        const providerRoutes = providersSnap.status === 'ready' && providersSnap.value?.providers
          && typeof providersSnap.value.providers === 'object'
          ? Object.entries(providersSnap.value.providers).filter(([, profile]) => profile !== null && typeof profile === 'object' && Array.isArray(profile.models))
          : [];
        const policyRoutes = policySnap.status === 'ready' && policySnap.value?.providers
          && typeof policySnap.value.providers === 'object'
          ? policySnap.value.providers
          : {};
        const writable = policySnap.status === 'ready' && policySnap.writable !== false;

        /** Read one route's switches with the same defaults the host applies. */
        const switches = (providerId) => {
          const entry = policyRoutes[providerId];
          return {
            reasoning: typeof entry?.reasoning === 'boolean' ? entry.reasoning : true,
            sniff: typeof entry?.sniff === 'boolean' ? entry.sniff : true,
          };
        };

        /** Write one switch; a failure surfaces as text, not as a silent revert. */
        const toggle = async (providerId, field) => {
          if (!writable) return;
          const key = providerId + '/' + field;
          const current = switches(providerId);
          setBusy(key);
          setError(null);
          try {
            const accepted = await policy.mutate([{
              op: 'set',
              path: ['providers', providerId, field],
              value: !current[field],
            }]);
            if (!accepted) setError(t('saveFailed'));
          } catch (caught) {
            setError(String((caught && caught.message) || caught));
          } finally {
            setBusy(null);
          }
        };

        const switchControl = (providerId, field, on, labels) => h('div', { className: 're_switchWrap' },
          h('button', {
            type: 'button',
            role: 'switch',
            className: 're_switch',
            'aria-checked': on ? 'true' : 'false',
            'aria-label': labels[field === 'reasoning' ? 'reasoning' : 'sniff'] + ' · ' + providerId,
            title: labels[field === 'reasoning' ? 'reasoningTitle' : 'sniffTitle'],
            disabled: !writable || busy === providerId + '/' + field,
            onClick: () => { void toggle(providerId, field); },
          }, h('span', { className: 're_knob' })));

        const labels = {
          reasoning: t('reasoning'),
          sniff: t('sniff'),
          reasoningTitle: t('reasoningOn'),
          sniffTitle: t('sniffOn'),
        };

        return h('div', { className: 're_body' },
          h('p', { className: 're_hint' }, t('hint')),
          providerRoutes.length === 0
            ? h('p', { className: 're_hint' }, providersSnap.status === 'ready' ? t('empty') : t('loading'))
            : h('div', null,
              h('div', { className: 're_headRow' },
                h('span', { className: 're_headName' }, t('provider')),
                h('span', { className: 're_toggleHead' }, t('reasoning')),
                h('span', { className: 're_toggleHead' }, t('sniff'))),
              providerRoutes.map(([providerId, profile]) => {
                const state = switches(providerId);
                const displayName = typeof profile.displayName === 'string' && profile.displayName.length > 0
                  ? profile.displayName
                  : providerId;
                return h('div', { key: providerId, className: 're_row' },
                  h('span', { className: 're_name' },
                    h('span', { className: 're_nameText', title: providerId }, displayName),
                    h('span', { className: 're_note' },
                      (state.reasoning ? t('reasoningOn') : t('reasoningOff')) + ' · ' + (state.sniff ? t('sniffOn') : t('sniffOff')))),
                  switchControl(providerId, 'reasoning', state.reasoning, labels),
                  switchControl(providerId, 'sniff', state.sniff, labels));
              })),
          writable ? null : h('p', { className: 're_hint' }, policySnap.status === 'ready' ? t('policyUnavailable') : t('unavailable')),
          error === null ? null : h('p', { className: 're_error', role: 'alert' }, error));
      } catch (caught) {
        // A panel must never take the page down if a settings shape drifts.
        return h('div', { className: 're_body' },
          h('p', { className: 're_error', role: 'alert' }, String((caught && caught.message) || caught)));
      }
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        const warn = (error) => {
          try { console.warn('[reasoning-effort]', error); } catch { /* console unavailable */ }
        };
        let t = (key) => key;
        try {
          installStyles();
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'reasoning-effort: copy dictionaries');
          t = ctx.locale.bind(NS);
        } catch (error) {
          warn(error);
        }
        let policy;
        let providers;
        try {
          policy = ctx.configForms.get(POLICY_NS);
          providers = ctx.configForms.get(PROVIDERS_NS);
        } catch (error) {
          warn(error);
          return;
        }
        const component = (props) => h(ReasoningAction, {
          wide: props.wide === true,
          t: typeof props.t === 'function' ? props.t : t,
          policy,
          providers,
        });
        try {
          ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
            name: 'sidebar.footer.action',
            id: 'reasoning-effort',
            locale: NS,
            order: 20,
          }, component));
        } catch (error) {
          warn(error);
        }
      },
    };
  },
});
