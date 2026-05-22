/*
 * PDF Flip Viewer Demo Wrapper v15
 *
 * Wrapper code: MIT License.
 *
 * Third-party libraries loaded by default:
 * - StPageFlip / page-flip: MIT License
 *   https://github.com/Nodlik/StPageFlip
 * - PDF.js: Apache License 2.0
 *   https://github.com/mozilla/pdf.js
 *
 * Keep this notice when copying this file into a React project.
 */

const DEFAULT_PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const DEFAULT_PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const DEFAULT_PAGE_FLIP_URL = 'https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.min.js';

const loadedScripts = new Map();

function loadScriptOnce(src) {
  if (loadedScripts.has(src)) return loadedScripts.get(src);

  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      if (existing.dataset.loaded === 'true') resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.pfvVendor = 'true';
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
    document.head.appendChild(script);
  });

  loadedScripts.set(src, promise);
  return promise;
}

function resolveMount(mount) {
  if (typeof mount === 'string') return document.querySelector(mount);
  if (mount instanceof HTMLElement) return mount;
  return null;
}

function createEl(tagName, className, text) {
  const el = document.createElement(tagName);
  if (className) el.className = className;
  if (typeof text === 'string') el.textContent = text;
  return el;
}

function createButton(label, className, type = 'button') {
  const button = document.createElement('button');
  button.type = type;
  button.className = className;
  button.textContent = label;
  return button;
}

async function loadPdfJs(pdfjsLibUrl, pdfjsWorkerUrl) {
  await loadScriptOnce(pdfjsLibUrl);
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error('PDF.js not found on window.pdfjsLib');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
  return pdfjsLib;
}

async function loadPageFlip(pageFlipUrl) {
  await loadScriptOnce(pageFlipUrl);
  if (!window.St || !window.St.PageFlip) {
    throw new Error('StPageFlip not found on window.St.PageFlip');
  }
  return window.St.PageFlip;
}

async function renderPdfPageToCanvas(pdfDoc, pageNumber, maxWidth, maxHeight) {
  const page = await pdfDoc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const ratio = Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height);
  const scale = Math.max(0.5, Math.min(ratio, 2));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.setAttribute('aria-label', `PDF page ${pageNumber}`);

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

function createThumbnailImageFromCanvas(sourceCanvas, pageNumber, maxThumbWidth = 150) {
  const ratio = Math.min(1, maxThumbWidth / sourceCanvas.width);
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = Math.max(1, Math.round(sourceCanvas.width * ratio));
  thumbCanvas.height = Math.max(1, Math.round(sourceCanvas.height * ratio));
  const context = thumbCanvas.getContext('2d');
  context.drawImage(sourceCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

  const img = document.createElement('img');
  img.className = 'pfv-thumb-strip__image';
  img.alt = `第 ${pageNumber} 頁縮圖`;
  img.loading = 'lazy';
  img.src = thumbCanvas.toDataURL('image/jpeg', 0.72);
  return img;
}

function clamp(number, min, max) {
  return Math.min(Math.max(number, min), max);
}

function getErrorMessage(error) {
  if (!error) return '發生未知錯誤。';
  if (String(error.message || '').includes('Missing PDF')) return '找不到 PDF 檔案，請確認 pdfUrl 是否正確。';
  return error.message || String(error);
}

function getAbsoluteUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch (_) {
    return url;
  }
}

function setStatusMessage(statusEl, message) {
  if (!statusEl) return;
  const textEl = statusEl.querySelector('.pfv-status__text');
  if (textEl) {
    textEl.textContent = message;
  } else {
    statusEl.textContent = message;
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}

export function createPdfFlipViewer(options = {}) {
  const {
    mount,
    pdfUrl,
    title = 'PDF Viewer',
    allowDownload = false,
    allowShare = false,
    showCard = true,
    initialPage = 1,
    minZoom = 1,
    maxZoom = 3,
    zoomStep = 0.25,
    pdfjsLibUrl = DEFAULT_PDFJS_URL,
    pdfjsWorkerUrl = DEFAULT_PDFJS_WORKER_URL,
    pageFlipUrl = DEFAULT_PAGE_FLIP_URL
  } = options;

  const root = resolveMount(mount);
  if (!root) throw new Error('PdfFlipViewer: mount element not found.');
  if (!pdfUrl) throw new Error('PdfFlipViewer: pdfUrl is required.');

  let pdfjsLib = null;
  let pdfDoc = null;
  let pageFlip = null;
  let modal = null;
  let destroyed = false;
  let currentPage = Math.max(1, initialPage);
  let totalPages = 0;
  let thumbnailItems = [];
  let thumbnailsRendered = false;

  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  let activePointerId = null;

  root.innerHTML = '';

  let card = null;
  let coverWrap = null;
  let openButton = null;

  if (showCard) {
    card = createEl('section', 'pfv-card');
    coverWrap = createEl('div', 'pfv-card__cover-wrap');
    const loading = createEl('div', 'pfv-card__loading', 'Loading...');
    const body = createEl('div', 'pfv-card__body');
    const titleEl = createEl('h2', 'pfv-card__title', title);
    openButton = createButton('Open PDF', 'pfv-button');

    coverWrap.appendChild(loading);
    body.append(titleEl, openButton);
    card.append(coverWrap, body);
    root.appendChild(card);
  }

  function setCoverError(message) {
    if (!coverWrap) return;
    coverWrap.innerHTML = '';
    coverWrap.appendChild(createEl('div', 'pfv-card__error', message));
  }

  async function initCover() {
    if (!showCard || !coverWrap) return;
    try {
      pdfjsLib = await loadPdfJs(pdfjsLibUrl, pdfjsWorkerUrl);
      pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
      totalPages = pdfDoc.numPages;
      const canvas = await renderPdfPageToCanvas(pdfDoc, 1, 720, 960);
      canvas.className = 'pfv-card__cover';
      coverWrap.innerHTML = '';
      coverWrap.appendChild(canvas);
    } catch (error) {
      setCoverError(`PDF cover failed: ${getErrorMessage(error)}`);
    }
  }

  function updatePageInfo(pageInfoEl) {
    if (!pageInfoEl) return;
    const safeTotal = totalPages || '?';
    pageInfoEl.textContent = `${currentPage} / ${safeTotal}`;
  }

  function applyTransform(transformEl, zoomInfoEl) {
    if (!transformEl) return;

    if (zoom <= 1) {
      panX = 0;
      panY = 0;
      transformEl.classList.remove('is-pannable');
    } else {
      transformEl.classList.add('is-pannable');
    }

    transformEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    if (zoomInfoEl) zoomInfoEl.textContent = `${Math.round(zoom * 100)}%`;
  }

  function setZoom(nextZoom, transformEl, zoomInfoEl) {
    zoom = clamp(Number(nextZoom) || 1, minZoom, maxZoom);
    applyTransform(transformEl, zoomInfoEl);
  }

  function resetView(transformEl, zoomInfoEl) {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform(transformEl, zoomInfoEl);
  }

  function close() {
    if (!modal) return;

    if (modal._pfvCleanupEvents) {
      modal._pfvCleanupEvents.forEach((cleanup) => cleanup());
      modal._pfvCleanupEvents = null;
    }

    if (pageFlip && typeof pageFlip.destroy === 'function') {
      pageFlip.destroy();
    }
    pageFlip = null;
    resetPointerState();
    modal.remove();
    modal = null;
  }

  function resetPointerState() {
    isPanning = false;
    activePointerId = null;
  }

  async function open() {
    if (destroyed || modal) return;

    zoom = 1;
    panX = 0;
    panY = 0;

    modal = createEl('div', 'pfv-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const dialog = createEl('div', 'pfv-modal__dialog');
    const header = createEl('header', 'pfv-modal__header');
    const modalTitle = createEl('h2', 'pfv-modal__title', '');
    const closeButton = createButton('&#10005;', 'pfv-button pfv-button--ghost pfv-button--icon');
    closeButton.innerHTML = '&#10005;';
    closeButton.setAttribute('aria-label', 'Close');

    const bodyEl = createEl('div', 'pfv-modal__body');
    const status = createEl('div', 'pfv-status');
    const statusSpinner = createEl('span', 'pfv-status__spinner');
    const statusText = createEl('span', 'pfv-status__text', 'Loading...');
    status.append(statusSpinner, statusText);
    const prevButton = createButton('‹', 'pfv-nav pfv-nav--prev');
    const nextButton = createButton('›', 'pfv-nav pfv-nav--next');
    const viewport = createEl('div', 'pfv-viewport');
    const transformEl = createEl('div', 'pfv-transform');
    const bookWrap = createEl('div', 'pfv-book-wrap');
    const book = createEl('div', 'pfv-book');

    const footer = createEl('footer', 'pfv-modal__footer');
    const pageInfo = createEl('span', 'pfv-page-info', '1 / ?');
    const zoomOutButton = createButton('－', 'pfv-button pfv-button--ghost pfv-button--tool');
    const zoomInfo = createEl('span', 'pfv-zoom-info', '100%');
    const zoomInButton = createButton('＋', 'pfv-button pfv-button--ghost pfv-button--tool');
    const resetButton = createButton('&#8635;', 'pfv-button pfv-button--ghost pfv-button--tool');
    resetButton.innerHTML = '&#8635;';
    resetButton.setAttribute('aria-label', 'Reset');
    const pageJumpButton = createButton('&#x1F5CE;', 'pfv-button pfv-button--ghost pfv-button--tool');
    pageJumpButton.innerHTML = '&#x1F5CE;';
    pageJumpButton.setAttribute('aria-label', 'Pages');
    pageJumpButton.setAttribute('aria-expanded', 'false');
    const downloadLink = createEl('a', 'pfv-link', '下載 PDF');
    downloadLink.href = pdfUrl;
    downloadLink.target = '_blank';
    downloadLink.rel = 'noopener';
    downloadLink.setAttribute('download', '');

    const shareButton = createButton('&#128279;', 'pfv-button pfv-button--ghost');
    shareButton.innerHTML = '&#128279;';
    shareButton.setAttribute('aria-label', 'Share link');
    const toast = createEl('div', 'pfv-toast');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const thumbPanel = createEl('section', 'pfv-thumb-strip');
    thumbPanel.hidden = true;
    thumbPanel.setAttribute('aria-label', 'PDF 快速跳頁');
    thumbPanel.setAttribute('aria-hidden', 'true');
    const thumbPanelHeader = createEl('div', 'pfv-thumb-strip__header');
    const thumbPanelTitle = createEl('strong', 'pfv-thumb-strip__title', '');
    const thumbPanelClose = createButton('', 'pfv-button pfv-button--ghost pfv-button--small');
    const thumbStripBody = createEl('div', 'pfv-thumb-strip__body');
    const thumbScrollPrev = createButton('‹', 'pfv-thumb-strip__arrow pfv-thumb-strip__arrow--prev');
    const thumbScrollNext = createButton('›', 'pfv-thumb-strip__arrow pfv-thumb-strip__arrow--next');
    const thumbGrid = createEl('div', 'pfv-thumb-strip__track');
    // v10: do not show the '快速跳頁' title and close button; keep only the bottom thumbnail strip.
    thumbStripBody.append(thumbScrollPrev, thumbGrid, thumbScrollNext);
    thumbPanel.append(thumbStripBody);

    header.append(closeButton);
    bookWrap.appendChild(book);
    transformEl.appendChild(bookWrap);
    viewport.appendChild(transformEl);
    bodyEl.append(status, viewport, prevButton, nextButton);
    footer.append(pageInfo, zoomOutButton, zoomInfo, zoomInButton, resetButton, pageJumpButton);
    if (allowDownload) footer.appendChild(downloadLink);
    if (allowShare) footer.appendChild(shareButton);
    dialog.append(header, bodyEl, thumbPanel, footer, toast);
    modal.appendChild(dialog);
    root.appendChild(modal);
    dialog.classList.add('is-loading');
    prevButton.disabled = true;
    nextButton.disabled = true;
    zoomOutButton.disabled = true;
    zoomInButton.disabled = true;
    resetButton.disabled = true;
    pageJumpButton.disabled = true;

    const cleanupEvents = [];
    const addManagedEvent = (target, eventName, handler, eventOptions) => {
      target.addEventListener(eventName, handler, eventOptions);
      cleanupEvents.push(() => target.removeEventListener(eventName, handler, eventOptions));
    };
    modal._pfvCleanupEvents = cleanupEvents;

    addManagedEvent(closeButton, 'click', () => close());
    addManagedEvent(modal, 'click', (event) => {
      if (event.target === modal) close();
    });
    addManagedEvent(document, 'keydown', (event) => {
      if (!modal) return;
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowLeft' && pageFlip) pageFlip.flipPrev();
      if (event.key === 'ArrowRight' && pageFlip) pageFlip.flipNext();
      if ((event.key === '+' || event.key === '=') && !event.ctrlKey && !event.metaKey) setZoom(zoom + zoomStep, transformEl, zoomInfo);
      if ((event.key === '-' || event.key === '_') && !event.ctrlKey && !event.metaKey) setZoom(zoom - zoomStep, transformEl, zoomInfo);
      if (event.key === '0' && !event.ctrlKey && !event.metaKey) resetView(transformEl, zoomInfo);
    });

    addManagedEvent(prevButton, 'click', () => {
      if (pageFlip) pageFlip.flipPrev();
    });

    addManagedEvent(nextButton, 'click', () => {
      if (pageFlip) pageFlip.flipNext();
    });

    addManagedEvent(zoomOutButton, 'click', () => setZoom(zoom - zoomStep, transformEl, zoomInfo));
    addManagedEvent(zoomInButton, 'click', () => setZoom(zoom + zoomStep, transformEl, zoomInfo));
    addManagedEvent(resetButton, 'click', () => resetView(transformEl, zoomInfo));

    addManagedEvent(transformEl, 'pointerdown', (event) => {
      if (zoom <= 1) return;
      if (event.button !== undefined && event.button !== 0) return;
      isPanning = true;
      activePointerId = event.pointerId;
      panStartX = event.clientX;
      panStartY = event.clientY;
      panOriginX = panX;
      panOriginY = panY;
      transformEl.classList.add('is-panning');
      transformEl.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    addManagedEvent(transformEl, 'pointermove', (event) => {
      if (!isPanning || activePointerId !== event.pointerId) return;
      panX = panOriginX + (event.clientX - panStartX);
      panY = panOriginY + (event.clientY - panStartY);
      applyTransform(transformEl, zoomInfo);
      event.preventDefault();
    });

    const endPan = (event) => {
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      transformEl.classList.remove('is-panning');
      transformEl.releasePointerCapture?.(event.pointerId);
      resetPointerState();
    };

    addManagedEvent(transformEl, 'pointerup', endPan);
    addManagedEvent(transformEl, 'pointercancel', endPan);
    addManagedEvent(transformEl, 'lostpointercapture', () => {
      transformEl.classList.remove('is-panning');
      resetPointerState();
    });

    addManagedEvent(viewport, 'wheel', (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      setZoom(zoom + direction * zoomStep, transformEl, zoomInfo);
    }, { passive: false });


    const setThumbPanelOpen = (isOpen) => {
      if (isOpen) {
        if (!thumbnailsRendered) renderThumbGrid();
        thumbPanel.hidden = false;
        window.requestAnimationFrame(() => {
          thumbPanel.classList.add('is-open');
          setActiveThumb(currentPage, true);
        });
      } else {
        thumbPanel.classList.remove('is-open');
        window.setTimeout(() => {
          if (!thumbPanel.classList.contains('is-open')) thumbPanel.hidden = true;
        }, 180);
      }

      thumbPanel.setAttribute('aria-hidden', String(!isOpen));
      pageJumpButton.setAttribute('aria-expanded', String(isOpen));
    };

    const setActiveThumb = (pageNumber, shouldScroll = false) => {
      let activeItem = null;
      thumbGrid.querySelectorAll('.pfv-thumb-strip__item').forEach((item) => {
        const isActive = Number(item.dataset.page) === pageNumber;
        item.classList.toggle('is-active', isActive);
        if (isActive) activeItem = item;
      });

      if (shouldScroll && activeItem) {
        activeItem.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    };

    const renderThumbGrid = () => {
      thumbGrid.innerHTML = '';
      const fragment = document.createDocumentFragment();

      thumbnailItems.forEach(({ pageNumber, image }) => {
        const item = createButton('', 'pfv-thumb-strip__item');
        item.setAttribute('aria-label', `跳到第 ${pageNumber} 頁`);
        item.dataset.page = String(pageNumber);
        item.appendChild(image.cloneNode(true));
        item.appendChild(createEl('span', 'pfv-thumb-strip__number', String(pageNumber))); 
        fragment.appendChild(item);
      });

      thumbGrid.appendChild(fragment);
      thumbnailsRendered = true;
      setActiveThumb(currentPage);
    };

    addManagedEvent(pageJumpButton, 'click', () => {
      setThumbPanelOpen(thumbPanel.hidden || !thumbPanel.classList.contains('is-open'));
    });

    addManagedEvent(thumbPanelClose, 'click', () => setThumbPanelOpen(false));
    addManagedEvent(thumbScrollPrev, 'click', () => {
      thumbGrid.scrollBy({ left: -Math.max(240, thumbGrid.clientWidth * 0.75), behavior: 'smooth' });
    });
    addManagedEvent(thumbScrollNext, 'click', () => {
      thumbGrid.scrollBy({ left: Math.max(240, thumbGrid.clientWidth * 0.75), behavior: 'smooth' });
    });

    addManagedEvent(thumbGrid, 'click', (event) => {
      const item = event.target.closest('.pfv-thumb-strip__item');
      if (!item || !pageFlip) return;

      const pageNumber = clamp(Number(item.dataset.page) || 1, 1, totalPages);
      pageFlip.flip(pageNumber - 1, 'top');
      currentPage = pageNumber;
      updatePageInfo(pageInfo);
      setActiveThumb(pageNumber);
      setThumbPanelOpen(false);
    });

    let toastTimer = null;
    cleanupEvents.push(() => { if (toastTimer) window.clearTimeout(toastTimer); });
    const showToast = (message) => {
      toast.textContent = message;
      toast.classList.add('is-visible');
      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        toast.classList.remove('is-visible');
      }, 2200);
    };

    addManagedEvent(shareButton, 'click', async () => {
      const shareUrl = getAbsoluteUrl(pdfUrl);
      const originalText = shareButton.textContent;
      shareButton.disabled = true;

      try {
        const copied = await copyTextToClipboard(shareUrl);
        if (copied) {
          shareButton.textContent = '已複製';
          showToast('PDF 連結已複製，可貼給其他人。');
        } else {
          window.prompt('瀏覽器無法自動複製，請手動複製 PDF 連結：', shareUrl);
          showToast('請手動複製 PDF 連結。');
        }
      } catch (_) {
        window.prompt('瀏覽器無法自動複製，請手動複製 PDF 連結：', shareUrl);
        showToast('請手動複製 PDF 連結。');
      } finally {
        window.setTimeout(() => {
          shareButton.textContent = originalText;
          shareButton.disabled = false;
        }, 1200);
      }
    });

    try {
      if (!pdfjsLib) pdfjsLib = await loadPdfJs(pdfjsLibUrl, pdfjsWorkerUrl);
      if (!pdfDoc) pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
      totalPages = pdfDoc.numPages;
      updatePageInfo(pageInfo);

      const PageFlip = await loadPageFlip(pageFlipUrl);
      // v14: calculate the book page from the real visible area and the PDF page ratio.
      // This prevents the PageFlip white background from becoming taller than the PDF canvas
      // on narrow RWD layouts.
      const bodyRect = bodyEl.getBoundingClientRect();
      const availableWidth = Math.max(260, Math.floor(bodyRect.width || window.innerWidth) - 96);
      const availableHeight = Math.max(280, Math.floor(bodyRect.height || window.innerHeight) - 16);
      const firstPage = await pdfDoc.getPage(1);
      const firstViewport = firstPage.getViewport({ scale: 1 });
      const pageRatio = firstViewport.height / firstViewport.width;
      const isMobile = availableWidth < 720;
      const horizontalPageLimit = isMobile
        ? Math.min(availableWidth, 430)
        : Math.min(460, Math.floor((availableWidth - 12) / 2));
      const verticalPageLimit = Math.floor(availableHeight / pageRatio);
      const maxPageWidth = Math.max(220, Math.min(horizontalPageLimit, verticalPageLimit));
      const maxPageHeight = Math.round(maxPageWidth * pageRatio);

      book.innerHTML = '';
      bookWrap.classList.add('is-preparing');
      setStatusMessage(status, 'Loading...');

      const renderedPages = [];
      thumbnailItems = [];
      thumbnailsRendered = false;
      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        if (destroyed || !modal) return;
        setStatusMessage(status, 'Loading...');
        const pageEl = createEl('div', 'pfv-page');
        const canvas = await renderPdfPageToCanvas(pdfDoc, pageNumber, maxPageWidth, maxPageHeight);
        const thumbImage = createThumbnailImageFromCanvas(canvas, pageNumber);
        pageEl.appendChild(canvas);
        renderedPages.push(pageEl);
        thumbnailItems.push({ pageNumber, image: thumbImage });
      }

      const fragment = document.createDocumentFragment();
      renderedPages.forEach((pageEl) => fragment.appendChild(pageEl));
      book.appendChild(fragment);

      setStatusMessage(status, 'Loading...');
      applyTransform(transformEl, zoomInfo);

      // Desktop behavior: cover is shown alone, then spreads are shown as page pairs.
      // Mobile behavior: forced portrait/single-page mode for readability.
      pageFlip = new PageFlip(book, {
        width: maxPageWidth,
        height: maxPageHeight,
        size: 'stretch',
        minWidth: Math.min(220, maxPageWidth),
        maxWidth: maxPageWidth,
        minHeight: Math.min(280, maxPageHeight),
        maxHeight: maxPageHeight,
        // v15: on narrow/mobile layouts, do not enable PageFlip cover mode.
        // Cover mode can leave the first page aligned to the top inside the internal
        // spread area, while pages 2+ are centered. Portrait mode already makes
        // page 1 single-page, so this keeps RWD behavior stable.
        showCover: !isMobile,
        usePortrait: isMobile,
        mobileScrollSupport: false,
        maxShadowOpacity: 0.25,
        flippingTime: 600
      });

      pageFlip.loadFromHTML(book.querySelectorAll('.pfv-page'));
      bookWrap.classList.remove('is-preparing');
      dialog.classList.remove('is-loading');
      status.remove();
      prevButton.disabled = false;
      nextButton.disabled = false;
      zoomOutButton.disabled = false;
      zoomInButton.disabled = false;
      resetButton.disabled = false;
      pageJumpButton.disabled = false;
      pageFlip.on('flip', (event) => {
        currentPage = Number(event.data) + 1;
        updatePageInfo(pageInfo);
        setActiveThumb(currentPage, thumbPanel.classList.contains('is-open'));
      });

      const startIndex = Math.min(Math.max(initialPage - 1, 0), totalPages - 1);
      if (startIndex > 0) {
        pageFlip.flip(startIndex, 'top');
        currentPage = startIndex + 1;
        updatePageInfo(pageInfo);
      }
    } catch (error) {
      dialog.classList.remove('is-loading');
      setStatusMessage(status, `PDF load failed: ${getErrorMessage(error)}`);
      prevButton.disabled = true;
      nextButton.disabled = true;
      zoomOutButton.disabled = true;
      zoomInButton.disabled = true;
      resetButton.disabled = true;
      pageJumpButton.disabled = true;
    }
  }

  if (showCard && openButton && coverWrap) {
    openButton.addEventListener('click', open);
    coverWrap.addEventListener('click', open);
    coverWrap.style.cursor = 'pointer';
    initCover();
  } else {
    // Preload PDF.js only. The PDF itself is loaded when the external link calls open().
    loadPdfJs(pdfjsLibUrl, pdfjsWorkerUrl).then((lib) => { pdfjsLib = lib; }).catch(() => {});
  }

  return {
    open,
    close,
    destroy() {
      destroyed = true;
      close();
      root.innerHTML = '';
    },
    getState() {
      return {
        pdfUrl,
        title,
        currentPage,
        totalPages,
        zoom,
        panX,
        panY,
        isOpen: Boolean(modal),
        destroyed
      };
    }
  };
}
