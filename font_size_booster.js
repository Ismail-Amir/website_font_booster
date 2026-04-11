// ==UserScript==
// @name         Font Size Booster
// @namespace    Violentmonkey
// @version      1.0
// @description  Increases font size by fixed pixels across DOM and Shadow DOM with debounced processing
// @author       Ismail Amir
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
// -------------------------------------------------



/*
 * Summary of fixes applied

  1. Debug log – moved console.log before originalData.clear() so it shows the correct count.

  2. Deep shadow DOM scanning – processPendingMutations now calls scanShadowRoots(node) instead of a shallow scanAndBoost + manual shadow root check. This ensures any nested shadow hosts inside added nodes are fully processed.

  3. Re‑enable re‑boosting – processedElements changed from const to let; when re‑enabling, a fresh WeakSet is created, forcing a full re‑scan of all elements.

  4. Shadow root tracking – removed the line that added host.shadowRoot to processedElements. It was unnecessary and could cause confusion (shadow roots aren't elements).

  5. Toggle style removal – remains unchanged and works correctly because it uses the current processedElements set. After disabling, the set is left intact (no need to clear it). When enabling, a new set is created and the old one is garbage collected.
 * */

(function() {
    'use strict';

    // ================= CONFIG =================
    const SCALE_FACTOR = 1.7;      // Proportional scaling multiplier
    // No MIN/MAX font size limits as requested

    // ================= STATE =================
    let processedElements = new WeakSet(); // Track processed elements (auto-GC)
    const debounceTimer = { id: null };
    const pendingMutations = [];
    let enabled = true; // Global toggle state

    /**
     * Apply font scaling to element with line-height adjustment
     */
    function applyFontBoost(el, originalFontSize, originalLineHeight) {
        if (!enabled) return;

        const newSize = originalFontSize * SCALE_FACTOR;
        el.style.setProperty('font-size', `${newSize}px`, 'important');

        // Scale line-height if it's a computable pixel value (avoid "normal", "%", etc.)
        if (originalLineHeight && !originalLineHeight.includes('normal') && !originalLineHeight.includes('%')) {
            const lhNum = parseFloat(originalLineHeight);
            if (!isNaN(lhNum)) {
                el.style.setProperty('line-height', `${lhNum * SCALE_FACTOR}px`, 'important');
            }
        }

        processedElements.add(el);
    }

    /**
     * Core boost function: two-phase approach prevents compounding
     */
    function scanAndBoost(root) {
        if (!root || !enabled) return;

        const candidates = new Set();

        // ── 1️⃣ Regular elements with text node children ──
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: node => {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    if (parent.hasAttribute('aria-hidden') || parent.getAttribute('role') === 'presentation') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
            }
        );

        let textNode;
        while (textNode = walker.nextNode()) {
            const parent = textNode.parentElement;
            if (parent && !processedElements.has(parent)) {
                candidates.add(parent);
            }
        }

        // ── 2️⃣ Form elements: input/textarea (text in value attr, not child nodes) ──
        const formElements = root.querySelectorAll('input, textarea');
        formElements.forEach(el => {
            if (!processedElements.has(el)) candidates.add(el);
        });

        // ── 3️⃣ Contenteditable elements (rich text editors, notes, etc.) ──
        const editableElements = root.querySelectorAll('[contenteditable="true"]');
        editableElements.forEach(el => {
            if (!processedElements.has(el)) candidates.add(el);
        });

        if (candidates.size === 0) return;

        // ── 4️⃣ Phase 1: Snapshot ORIGINAL computed styles ──
        const originalData = new Map();
        for (const el of candidates) {
            try {
                const style = getComputedStyle(el);
                const fontSize = parseFloat(style.fontSize);
                const lineHeight = style.lineHeight;

                if (!isNaN(fontSize)) {
                    originalData.set(el, { fontSize, lineHeight });
                }
            } catch (e) {
                // Skip elements that throw (e.g., disconnected nodes)
                continue;
            }
        }

        // ── 5️⃣ Phase 2: Apply scaling from snapshot ──
        for (const [el, data] of originalData) {
            applyFontBoost(el, data.fontSize, data.lineHeight);
        }

        // Debug logging (fixed: log before clearing)
        if (originalData.size > 0) {
            console.log(`[Font Booster] Boosted ${originalData.size} elements`);
        }
        originalData.clear();
    }

    /**
     * Recursively scan Shadow DOM roots (for Web Components)
     * FIXED: no longer adds shadowRoot objects to processedElements
     */
    function scanShadowRoots(root) {
        if (!root) return;

        // Scan the root document fragment itself
        scanAndBoost(root);

        // Find all shadow hosts within this root and recurse
        try {
            const shadowHosts = root.querySelectorAll('*');
            shadowHosts.forEach(host => {
                if (host.shadowRoot) {
                    scanShadowRoots(host.shadowRoot);
                }
            });
        } catch (e) {
            // Ignore cross-origin shadow root access errors
        }
    }

    /**
     * Process queued DOM mutations (debounced + idle-aware)
     * FIXED: now properly scans entire subtrees including nested shadow DOMs
     */
    function processPendingMutations() {
        if (pendingMutations.length === 0) return;

        const nodesToScan = new Set();
        for (const mut of pendingMutations) {
            for (const node of mut.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    nodesToScan.add(node);
                }
            }
        }
        pendingMutations.length = 0;

        const doScan = () => {
            nodesToScan.forEach(node => {
                scanShadowRoots(node); // FIXED: recurses into all shadow roots inside node
            });
        };

        // Use requestIdleCallback for non-urgent execution if available
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(doScan, { timeout: 1000 });
        } else {
            doScan();
        }
    }

    /**
     * Setup MutationObserver for SPAs & dynamic content
     */
    function setupObserver() {
        const observer = new MutationObserver(mutations => {
            let hasAdditions = false;
            for (const mut of mutations) {
                if (mut.addedNodes.length > 0) {
                    hasAdditions = true;
                    pendingMutations.push(mut);
                }
            }
            if (hasAdditions) {
                clearTimeout(debounceTimer.id);
                debounceTimer.id = setTimeout(processPendingMutations, 250);
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Toggle boosting on/off with visual feedback
     * FIXED: re‑enabling now correctly re‑boosts all elements
     */
    function toggleBoost() {
        enabled = !enabled;

        if (enabled) {
            // Reset processed elements to allow re‑scanning everything
            processedElements = new WeakSet();
            // Re-apply to all elements when re-enabling
            scanAndBoost(document.body || document.documentElement);
            scanShadowRoots(document);
            showNotification('Font Booster: ✅ Enabled');
        } else {
            // Remove applied styles when disabling
            document.querySelectorAll('*').forEach(el => {
                if (processedElements.has(el)) {
                    el.style.removeProperty('font-size');
                    el.style.removeProperty('line-height');
                }
            });
            showNotification('Font Booster: ⏸️ Disabled');
        }
        console.log(`[Font Booster] ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    /**
     * Lightweight in-page notification (no dependencies)
     */
    function showNotification(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px;
            background: #333; color: #fff; padding: 10px 16px;
            border-radius: 6px; font-size: 14px; z-index: 99999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: fadeout 2.5s forwards;
        `;
        document.body.appendChild(toast);

        // Add CSS animation if not already present
        if (!document.getElementById('font-booster-styles')) {
            const style = document.createElement('style');
            style.id = 'font-booster-styles';
            style.textContent = `@keyframes fadeout { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }`;
            document.head.appendChild(style);
        }

        setTimeout(() => toast.remove(), 2500);
    }

    /**
     * Initialize the script
     */
    function init() {
        console.log('[Font Booster] Initializing v2.1...');
        scanAndBoost(document.body || document.documentElement);
        scanShadowRoots(document);
        setupObserver();
        console.log(`[Font Booster] ✅ Active | Scale: ${SCALE_FACTOR}x | Toggle: Alt+T | Re-scan: Alt+R`);
    }

    // ── Run when DOM is ready ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        // Slight delay ensures CSSOM is parsed for accurate getComputedStyle()
        setTimeout(init, 100);
    }

    // ── Keyboard shortcuts ──
    document.addEventListener('keydown', e => {
        if (!e.altKey) return;

        const key = e.key.toLowerCase();
        if (key === 'r') {
            e.preventDefault();
            console.log('[Font Booster] 🔄 Manual re-scan...');
            scanAndBoost(document.body || document.documentElement);
            scanShadowRoots(document);
            showNotification('Font Booster: 🔄 Re-scanned');
        } else if (key === 't') {
            e.preventDefault();
            toggleBoost();
        }
    }, { capture: true });

    // ── Re-scan when returning to tab (catches lazy-loaded content) ──
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && enabled) {
            setTimeout(() => scanAndBoost(document.body), 500);
        }
    });
})();
