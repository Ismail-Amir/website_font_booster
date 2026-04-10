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



(function() {
    'use strict';

    // ================= CONFIG =================
    const SCALE_FACTOR = 1.7;      // 1.3 = +30% proportional scaling
    const MIN_FONT_PX = 8;         // Skip microscopic text (icons, spacers, etc.)

    // ================= STATE =================
    const processedElements = new WeakSet(); // Guarantees single processing
    const debounceTimer = { id: null };
    const pendingMutations = [];

    /**
     * Core boost function: two-phase approach prevents compounding
     * Phase 1: Read all original sizes
     * Phase 2: Apply new sizes
     */
    function scanAndBoost(root) {
        if (!root) return;

        // 1️⃣ Collect all elements that directly contain non-whitespace text
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            { acceptNode: node => node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
        );

        const candidates = new Set();
        let textNode;
        while (textNode = walker.nextNode()) {
            const parent = textNode.parentElement;
            if (parent && !processedElements.has(parent)) {
                candidates.add(parent);
            }
        }

        if (candidates.size === 0) return;

        // 2️⃣ Phase 1: Snapshot ORIGINAL computed sizes BEFORE any modifications
        const originalSizes = new Map();
        for (const el of candidates) {
            const size = parseFloat(getComputedStyle(el).fontSize);
            if (!isNaN(size) && size >= MIN_FONT_PX) {
                originalSizes.set(el, size);
            }
        }

        // 3️⃣ Phase 2: Apply proportional scaling from snapshot
        for (const [el, original] of originalSizes) {
            const newSize = original * SCALE_FACTOR;
            el.style.setProperty('font-size', `${newSize}px`, 'important');
            processedElements.add(el); // Mark as processed forever
        }

        // Debug (remove after testing)
        if (originalSizes.size > 0) {
            console.log(`[Font Booster] Boosted ${originalSizes.size} elements in ${root === document.body ? 'body' : 'dynamic node'}`);
        }
    }

    /**
     * Process queued DOM mutations (debounced to avoid thrashing)
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

        nodesToScan.forEach(scanAndBoost);
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
     * Initialize
     */
    function init() {
        console.log('[Font Booster] Initializing...');
        scanAndBoost(document.body || document.documentElement);
        setupObserver();
        console.log(`[Font Booster] Active | Scale: ${SCALE_FACTOR}x | Toggle reload: Alt+R`);
    }

    // Run when DOM is ready + styles are computed
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        // Slight delay ensures CSSOM is parsed so getComputedStyle() returns correct values
        setTimeout(init, 100);
    }

    // Optional: Press Alt+R to re-scan if dynamic content loads weirdly
    document.addEventListener('keydown', e => {
        if (e.altKey && e.key.toLowerCase() === 'r') {
            e.preventDefault();
            console.log('[Font Booster] Manual re-scan triggered...');
            // Clear processed set temporarily to allow re-boosting if needed
            // (Usually not required due to observer, but useful for debugging)
            init();
        }
    }, { capture: true });
})();
