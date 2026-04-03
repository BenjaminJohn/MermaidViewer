import * as React from "react";
import mermaid from "mermaid";
import pako from "pako";
import { IconButton, initializeIcons, Stack, TooltipHost } from "@fluentui/react";

initializeIcons();

export interface IMermaidViewerProps {
  value: string;
  onChange: (nextValue: string) => void;
  strings: IMermaidViewerStrings;
  tabAccentColor: string;
  entityName?: string;
  entityId?: string;
  readOnly?: boolean;
}

type TabKey = "diagram" | "code";

export interface IMermaidViewerStrings {
  tabDiagram: string;
  tabCode: string;
  tooltipUndo: string;
  tooltipRedo: string;
  tooltipCopySvg: string;
  tooltipCopyCode: string;
  tooltipDownloadSvg: string;
  tooltipDownloadCode: string;
  tooltipFullscreen: string;
  tooltipExitFullscreen: string;
  tooltipOpenInMermaidLive: string;
  statusUndo: string;
  statusRedo: string;
  statusSvgCopied: string;
  statusCodeCopied: string;
  statusNoSvg: string;
  statusSvgDownloaded: string;
  statusCodeDownloaded: string;
  statusFullscreenUnavailable: string;
  statusNoDiagram: string;
  statusNoCode: string;
  statusPopupBlocked: string;
  statusCopyUnavailable: string;
}

interface IMermaidViewerState {
  activeTab: TabKey;
  error: string | null;
  statusMessage: string | null;
  statusIntent: "info" | "error";
  history: string[];
  historyIndex: number;
  isFullscreen: boolean;
  hasSvg: boolean;
  codeValue: string;
  zoom: number;
  panX: number;
  panY: number;
}

export class MermaidViewerView extends React.Component<IMermaidViewerProps, IMermaidViewerState> {
  private codeRef = React.createRef<HTMLTextAreaElement>();
  private codeHighlightRef = React.createRef<HTMLPreElement>();
  private codeContainerRef = React.createRef<HTMLDivElement>();
  private lineNumberRef = React.createRef<HTMLPreElement>();
  private previewRef = React.createRef<HTMLDivElement>();
  private svgContainerRef = React.createRef<HTMLDivElement>();
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartPanX = 0;
  private dragStartPanY = 0;
  private renderIndex = 0;
  private isMermaidReady = false;
  private renderTimer: number | undefined;
  private layoutRetryCount = 0;
  private resizeObserver: ResizeObserver | null = null;
  private statusTimer: number | undefined;
  private historyTimer: number | undefined;
  private lastRenderedValue = "";
  private lastRenderedSvg = "";
  private pendingRenderValue: string | null = null;
  private pendingLocalChange = false;

  constructor(props: IMermaidViewerProps) {
    super(props);
    this.state = {
      activeTab: (props.readOnly || (props.value ?? "").trim()) ? "diagram" : "code",
      error: null,
      statusMessage: null,
      statusIntent: "info",
      history: [props.value ?? ""],
      historyIndex: 0,
      isFullscreen: false,
      hasSvg: false,
      codeValue: props.value ?? "",
      zoom: 1,
      panX: 0,
      panY: 0,
    };
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const preview = this.previewRef.current;
    if (!preview) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      if (this.state.activeTab === "diagram") {
        this.renderWhenReady(this.props.value ?? "");
      }
    });
    this.resizeObserver.observe(preview);
  }

  public componentDidMount(): void {

    if (!this.isMermaidReady) {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
      this.isMermaidReady = true;
    }
    document.addEventListener("fullscreenchange", this.handleFullscreenChange);
    this.previewRef.current?.addEventListener("wheel", this.handleWheel, { passive: false });
    this.setupResizeObserver();
    this.scheduleRender(0, this.props.value);
  }

  public componentWillUnmount(): void {
    if (this.renderTimer) {
      window.clearTimeout(this.renderTimer);
    }
    if (this.statusTimer) {
      window.clearTimeout(this.statusTimer);
    }
    if (this.historyTimer) {
      window.clearTimeout(this.historyTimer);
    }
    this.previewRef.current?.removeEventListener("wheel", this.handleWheel);
    this.resizeObserver?.disconnect();
    document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
  }

  public componentDidUpdate(prevProps: IMermaidViewerProps, prevState: IMermaidViewerState): void {
    const valueChanged = prevProps.value !== this.props.value;
    if (valueChanged) {
      if (this.pendingLocalChange) {
        this.pendingLocalChange = false;
        if (this.state.codeValue !== this.props.value) {
          this.setState({ codeValue: this.props.value });
        }
      } else {
        const newValue = this.props.value ?? "";
        const nextState: Partial<IMermaidViewerState> = {
          history: [newValue],
          historyIndex: 0,
        };
        if (this.state.codeValue !== newValue) {
          nextState.codeValue = newValue;
        }
        this.setState(nextState as IMermaidViewerState);
      }

      if (this.state.activeTab === "diagram") {
        const nextValue = this.props.value ?? "";
        if (!this.state.hasSvg && nextValue.trim()) {
          this.renderWhenReady(nextValue);
        } else {
          this.scheduleRender(300, nextValue);
        }
      }
    }

    if (prevState.activeTab !== this.state.activeTab && this.state.activeTab === "diagram") {
      this.scheduleRender(0, this.props.value);
    }
  }

  private handleFullscreenChange = (): void => {
    const target =
      this.state.activeTab === "code" ? this.codeContainerRef.current : this.previewRef.current;
    const isFullscreen = document.fullscreenElement === target;
    if (this.state.isFullscreen !== isFullscreen) {
      this.setState({ isFullscreen }, () => {
        if (this.state.activeTab === "diagram") {
          window.setTimeout(() => this.fitToContainer(), 100);
        }
      });
    }
  };

  private renderWhenReady(value: string): void {
    const preview = this.previewRef.current;
    if (!preview) {
      return;
    }
    const width = preview.clientWidth;
    const height = preview.clientHeight;
    if ((width === 0 || height === 0) && this.layoutRetryCount < 10) {
      this.layoutRetryCount += 1;
      window.setTimeout(() => this.renderWhenReady(value), 50);
      return;
    }
    this.layoutRetryCount = 0;
    void this.renderMermaid(value);
  }

  private scheduleRender(delayMs: number, value: string): void {
    this.pendingRenderValue = value;
    if (this.renderTimer) {
      window.clearTimeout(this.renderTimer);
    }
    this.renderTimer = window.setTimeout(() => {
      const source = this.pendingRenderValue ?? this.props.value;
      this.pendingRenderValue = null;
      this.renderWhenReady(source);
    }, delayMs);
  }

  private async renderMermaid(value: string): Promise<void> {
    const source = value.trim();
    const preview = this.previewRef.current;
    const svgContainer = this.svgContainerRef.current;
    if (!preview || !svgContainer) {
      return;
    }

    if (source === this.lastRenderedValue && this.state.hasSvg) {
      if (svgContainer.innerHTML === "" && this.lastRenderedSvg) {
        svgContainer.innerHTML = this.lastRenderedSvg;
        this.fitToContainer();
      }
      return;
    }

    if (!source) {
      svgContainer.innerHTML = "";
      this.lastRenderedValue = "";
      this.lastRenderedSvg = "";
      if (this.state.error || this.state.hasSvg) {
        this.setState({ error: null, hasSvg: false });
      }
      return;
    }

    try {
      const renderId = `mermaid-${this.renderIndex++}`;
      const { svg } = await mermaid.render(renderId, source);
      svgContainer.innerHTML = svg;
      this.fitToContainer();
      this.lastRenderedSvg = svg;
      this.lastRenderedValue = source;
      if (this.state.error || !this.state.hasSvg) {
        this.setState({ error: null, hasSvg: true });
      }
    } catch (error) {
      svgContainer.innerHTML = "";
      this.lastRenderedSvg = "";
      this.setState({ error: String(error), hasSvg: false });
    }
  }

  private setStatus(message: string, intent: "info" | "error" = "info"): void {
    if (this.statusTimer) {
      window.clearTimeout(this.statusTimer);
    }
    this.setState({ statusMessage: message, statusIntent: intent });
    this.statusTimer = window.setTimeout(() => {
      this.setState({ statusMessage: null });
    }, 2000);
  }

  private handleTabSelect = (nextTab: TabKey): void => {
    if (nextTab === this.state.activeTab || (this.props.readOnly && nextTab === "code")) {
      return;
    }
    this.setState({ activeTab: nextTab }, () => {
      if (nextTab === "diagram") {
        if (this.previewRef.current) {
          this.renderWhenReady(this.props.value);
        } else {
          this.scheduleRender(0, this.props.value);
        }
      }
    });
  };

  private handleCodeScroll = (): void => {
    const code = this.codeRef.current;
    const highlight = this.codeHighlightRef.current;
    const lineNumbers = this.lineNumberRef.current;
    if (!code || !highlight || !lineNumbers) {
      return;
    }
    highlight.scrollTop = code.scrollTop;
    highlight.scrollLeft = code.scrollLeft;
    lineNumbers.scrollTop = code.scrollTop;
  };

  private handleChange = (nextValue: string): void => {
    this.pendingLocalChange = true;
    this.setState({ codeValue: nextValue });
    this.props.onChange(nextValue);
    this.scheduleHistoryCommit(nextValue);
    if (this.state.activeTab === "diagram") {
      this.scheduleRender(300, nextValue);
    }
  };

  private scheduleHistoryCommit(value: string): void {
    if (this.historyTimer) {
      window.clearTimeout(this.historyTimer);
    }
    this.historyTimer = window.setTimeout(() => {
      this.commitToHistory(value);
    }, 1500);
  }

  private commitToHistory(value: string): void {
    const { history, historyIndex } = this.state;
    if (history[historyIndex] === value) {
      return;
    }
    const trimmed = history.slice(0, historyIndex + 1);
    trimmed.push(value);
    const capped = trimmed.length > 50 ? trimmed.slice(trimmed.length - 50) : trimmed;
    this.setState({ history: capped, historyIndex: capped.length - 1 });
  }

  private handleUndo = (): void => {
    const { history, historyIndex } = this.state;
    if (historyIndex <= 0) {
      return;
    }
    const nextIndex = historyIndex - 1;
    const undoValue = history[nextIndex];
    this.pendingLocalChange = true;
    this.setState({ historyIndex: nextIndex, codeValue: undoValue }, () => {
      this.props.onChange(undoValue);
      if (this.state.activeTab === "diagram") {
        this.scheduleRender(0, undoValue);
      }
      this.setStatus(this.props.strings.statusUndo);
    });
  };

  private handleRedo = (): void => {
    const { history, historyIndex } = this.state;
    if (historyIndex >= history.length - 1) {
      return;
    }
    const nextIndex = historyIndex + 1;
    const redoValue = history[nextIndex];
    this.pendingLocalChange = true;
    this.setState({ historyIndex: nextIndex, codeValue: redoValue }, () => {
      this.props.onChange(redoValue);
      if (this.state.activeTab === "diagram") {
        this.scheduleRender(0, redoValue);
      }
      this.setStatus(this.props.strings.statusRedo);
    });
  };

  private getCurrentSvgMarkup(): string {
    if (this.lastRenderedSvg) {
      return this.lastRenderedSvg;
    }
    const preview = this.previewRef.current;
    const svgElement = preview?.querySelector("svg");
    return svgElement ? svgElement.outerHTML : "";
  }

  private buildDownloadBase(): string {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(
      now.getHours()
    )}${pad(now.getMinutes())}`;
    const rawName = this.props.entityName || "entity";
    const rawId = this.props.entityId || "unknown";
    const safeName = rawName.replace(/[^A-Za-z0-9_.-]/g, "-");
    const safeId = rawId.replace(/[^A-Za-z0-9_.-]/g, "-");
    return `${timestamp} ${safeName}_${safeId}`;
  }

  private async handleCopySvg(): Promise<void> {
    const svg = this.getCurrentSvgMarkup();
    if (!svg) {
      this.setStatus(this.props.strings.statusNoSvg, "error");
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(svg);
        this.setStatus(this.props.strings.statusSvgCopied);
        return;
      }
    } catch {
      // fallback below
    }

    const fallback = document.createElement("textarea");
    fallback.value = svg;
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    const success = document.execCommand("copy");
    document.body.removeChild(fallback);
    this.setStatus(
      success ? this.props.strings.statusSvgCopied : this.props.strings.statusCopyUnavailable,
      success ? "info" : "error"
    );
  }

  private async handleCopyCode(): Promise<void> {
    const code = this.state.codeValue ?? "";
    if (!code.trim()) {
      this.setStatus(this.props.strings.statusNoCode, "error");
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        this.setStatus(this.props.strings.statusCodeCopied);
        return;
      }
    } catch {
      // fallback below
    }

    const fallback = document.createElement("textarea");
    fallback.value = code;
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    const success = document.execCommand("copy");
    document.body.removeChild(fallback);
    this.setStatus(
      success ? this.props.strings.statusCodeCopied : this.props.strings.statusCopyUnavailable,
      success ? "info" : "error"
    );
  }

  private handleDownloadSvg = (): void => {
    const svg = this.getCurrentSvgMarkup();
    if (!svg) {
      this.setStatus(this.props.strings.statusNoSvg, "error");
      return;
    }

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const fileName = `${this.buildDownloadBase()}.svg`;

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    this.setStatus(this.props.strings.statusSvgDownloaded);
  };

  private handleDownloadCode = (): void => {
    const code = this.state.codeValue ?? "";
    if (!code.trim()) {
      this.setStatus(this.props.strings.statusNoCode, "error");
      return;
    }

    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const fileName = `${this.buildDownloadBase()}.mermaid`;

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    this.setStatus(this.props.strings.statusCodeDownloaded);
  };

  private handleCopyCurrent = async (): Promise<void> => {
    if (this.state.activeTab === "code") {
      await this.handleCopyCode();
    } else {
      await this.handleCopySvg();
    }
  };

  private handleDownloadCurrent = (): void => {
    if (this.state.activeTab === "code") {
      this.handleDownloadCode();
    } else {
      this.handleDownloadSvg();
    }
  };

  private handleToggleFullscreen = async (): Promise<void> => {
    const target =
      this.state.activeTab === "code" ? this.codeContainerRef.current : this.previewRef.current;
    if (!target?.requestFullscreen) {
      this.setStatus(this.props.strings.statusFullscreenUnavailable, "error");
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch {
      this.setStatus(this.props.strings.statusFullscreenUnavailable, "error");
    }
  };

  private handleOpenInMermaidLive = (): void => {
    const source = this.props.value ?? "";
    if (!source.trim()) {
      this.setStatus(this.props.strings.statusNoDiagram, "error");
      return;
    }

    const payloadObject = {
      code: source,
      mermaid: JSON.stringify({ theme: "default" }),
      updateDiagram: true,
      rough: false,
      panZoom: true,
    };
    const payloadJson = JSON.stringify(payloadObject);
    const encoder = new TextEncoder();
    const compressed = pako.deflate(encoder.encode(payloadJson), { level: 9 });
    const payload = this.toBase64Url(compressed);
    const url = `https://mermaid.ai/play#pako:${payload}`;
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      this.setStatus(this.props.strings.statusPopupBlocked, "error");
    }
  };

  private toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  private fitToContainer(): void {
    const outer = this.previewRef.current;
    const inner = this.svgContainerRef.current;
    if (!outer || !inner) {
      return;
    }
    const svgEl = inner.querySelector<SVGSVGElement>("svg");
    if (!svgEl) {
      return;
    }
    // Reset transform temporarily to measure natural SVG size
    const saved = inner.style.transform;
    inner.style.transform = "none";
    const svgW = svgEl.scrollWidth;
    const svgH = svgEl.scrollHeight;
    inner.style.transform = saved;
    if (!svgW || !svgH) {
      return;
    }
    const padding = 16;
    const availW = Math.max(1, outer.clientWidth - padding);
    const availH = Math.max(1, outer.clientHeight - padding);
    const fitZoom = Math.min(availW / svgW, availH / svgH);
    const panX = (availW - svgW * fitZoom) / 2 + padding / 2;
    const panY = (availH - svgH * fitZoom) / 2 + padding / 2;
    // Apply immediately to DOM to avoid flash, then sync to React state
    inner.style.transform = `translate(${panX}px, ${panY}px) scale(${fitZoom})`;
    this.setState({ zoom: fitZoom, panX, panY });
  }

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const outer = this.previewRef.current;
    if (!outer) {
      return;
    }
    const rect = outer.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const { zoom, panX, panY } = this.state;
    const newZoom = Math.max(0.05, Math.min(20, zoom * factor));
    const contentX = (cx - panX) / zoom;
    const contentY = (cy - panY) / zoom;
    const newPanX = cx - contentX * newZoom;
    const newPanY = cy - contentY * newZoom;
    this.setState({ zoom: newZoom, panX: newPanX, panY: newPanY });
  };

  private handlePanStart = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragStartPanX = this.state.panX;
    this.dragStartPanY = this.state.panY;
    if (this.previewRef.current) {
      this.previewRef.current.style.cursor = "grabbing";
    }
  };

  private handlePanMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!this.isDragging) {
      return;
    }
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    this.setState({ panX: this.dragStartPanX + dx, panY: this.dragStartPanY + dy });
  };

  private handlePanEnd = (): void => {
    if (!this.isDragging) {
      return;
    }
    this.isDragging = false;
    if (this.previewRef.current) {
      this.previewRef.current.style.cursor = "grab";
    }
  };

  private handleDoubleClick = (): void => {
    this.fitToContainer();
  };

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private highlightMermaid(value: string): string {
    const lines = value.split(/\r?\n/);
    return lines
      .map((line) => {
        const commentIndex = line.indexOf("%%");
        const codePart = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
        const commentPart = commentIndex >= 0 ? line.slice(commentIndex) : "";
        return (
          this.highlightMermaidSegment(codePart) +
          (commentPart ? `<span class="mm-comment">${this.escapeHtml(commentPart)}</span>` : "")
        );
      })
      .join("\n");
  }

  private highlightMermaidSegment(text: string): string {
    const diagramKeywords =
      "flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|architecture-beta|xychart(?:-beta)?|packet(?:-beta)?|radar(?:-beta)?|sankey(?:-beta)?";
    const keywords =
      "subgraph|end|direction|classDef|class|click|linkStyle|style|state|note|participant|actor|alt|opt|loop|par|rect|activate|deactivate|title|section|task|accTitle|accDescr|call|return|create|destroy|autonumber|namespace|service|group|default|left|right|top|bottom|horizontal|vertical";
    const tokenRegex = new RegExp(
      `("([^"\\\\]|\\\\.)*")|\\b(${diagramKeywords})\\b|\\b(${keywords})\\b|(-->|---|==>|<-->|<--|<==|<->|-\\.->|\\.{1,4}-|-\\.{1,4}|==|--)|(\\b\\d+(?:\\.\\d+)?\\b)`,
      "g"
    );
    let result = "";
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = tokenRegex.exec(text)) !== null) {
      result += this.escapeHtml(text.slice(lastIndex, match.index));
      if (match[1]) {
        result += `<span class="mm-string">${this.escapeHtml(match[1])}</span>`;
      } else if (match[3]) {
        result += `<span class="mm-diagram">${this.escapeHtml(match[3])}</span>`;
      } else if (match[4]) {
        result += `<span class="mm-keyword">${this.escapeHtml(match[4])}</span>`;
      } else if (match[5]) {
        result += `<span class="mm-arrow">${this.escapeHtml(match[5])}</span>`;
      } else if (match[6]) {
        result += `<span class="mm-number">${this.escapeHtml(match[6])}</span>`;
      }
      lastIndex = match.index + match[0].length;
    }
    result += this.escapeHtml(text.slice(lastIndex));
    return result;
  }

  public render(): React.ReactNode {
    const hasSvg = this.state.hasSvg;
    const hasCode = Boolean(this.state.codeValue?.trim());
    const canUndo = this.state.historyIndex > 0;
    const canRedo = this.state.historyIndex < this.state.history.length - 1;
    const lineCount = Math.max(1, this.state.codeValue.split(/\r?\n/).length);
    const lineNumbers = Array.from({ length: lineCount }, (_value, index) => index + 1).join("\n");
    const isCodeTab = this.state.activeTab === "code";
    const copyLabel = isCodeTab ? this.props.strings.tooltipCopyCode : this.props.strings.tooltipCopySvg;
    const downloadLabel = isCodeTab
      ? this.props.strings.tooltipDownloadCode
      : this.props.strings.tooltipDownloadSvg;
    const copyDisabled = isCodeTab ? !hasCode : !hasSvg;
    const downloadDisabled = isCodeTab ? !hasCode : !hasSvg;
    const commandBarItems = [
      {
        key: "undo",
        iconName: "Undo",
        onClick: this.handleUndo,
        disabled: !canUndo,
        label: this.props.strings.tooltipUndo,
      },
      {
        key: "redo",
        iconName: "Redo",
        onClick: this.handleRedo,
        disabled: !canRedo,
        label: this.props.strings.tooltipRedo,
      },
      {
        key: "copy",
        iconName: "Copy",
        onClick: () => void this.handleCopyCurrent(),
        disabled: copyDisabled,
        label: copyLabel,
      },
      {
        key: "download",
        iconName: "Download",
        onClick: this.handleDownloadCurrent,
        disabled: downloadDisabled,
        label: downloadLabel,
      },
      {
        key: "fullscreen",
        iconName: this.state.isFullscreen ? "BackToWindow" : "FullScreen",
        onClick: () => void this.handleToggleFullscreen(),
        label: this.state.isFullscreen
          ? this.props.strings.tooltipExitFullscreen
          : this.props.strings.tooltipFullscreen,
      },
      {
        key: "open",
        iconName: "OpenInNewWindow",
        onClick: this.handleOpenInMermaidLive,
        label: this.props.strings.tooltipOpenInMermaidLive,
      },
    ];
    const historyKeys = new Set(["undo", "redo"]);
    const visibleItems = this.props.readOnly
      ? commandBarItems.filter((item) => !historyKeys.has(item.key))
      : (canUndo || canRedo)
        ? commandBarItems
        : commandBarItems.filter((item) => !historyKeys.has(item.key));
    const showCodeTab = !this.props.readOnly && isCodeTab;
    const codeKeys = new Set(["undo", "redo", "copy", "download", "fullscreen", "open"]);
    const toolbarItems = showCodeTab
      ? visibleItems.filter((item) => codeKeys.has(item.key))
      : visibleItems;
    const primaryItems = toolbarItems.filter((item) => historyKeys.has(item.key));
    const secondaryItems = toolbarItems.filter((item) => !historyKeys.has(item.key));

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          fontFamily: "Segoe UI, Arial, sans-serif",
          padding: "8px 10px",
          color: "#323130",
          background: "#ffffff",
          width: "100%",
          minWidth: 0,
          height: "100%",
          minHeight: 0,
          flex: "1 1 auto",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#ffffff",
            borderBottom: "1px solid #edebe9",
            padding: "4px 2px 6px",
          }}
        >
          <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 12 }}>
            {!this.props.readOnly && (
              <div role="tablist" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {([
                  { key: "diagram", label: this.props.strings.tabDiagram },
                  { key: "code", label: this.props.strings.tabCode },
                ] as const).map((tab) => {
                  const isActive = this.state.activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => this.handleTabSelect(tab.key)}
                      style={{
                        border: "none",
                        background: "transparent",
                        padding: "0 2px",
                        cursor: "pointer",
                        color: "#242424",
                        fontFamily: "Segoe UI, Arial, sans-serif",
                      }}
                    >
                      <span
                        className={`mv-tab-label${isActive ? " is-active" : ""}`}
                        style={{
                          display: "inline-block",
                          fontSize: 14,
                          lineHeight: "14px",
                          textTransform: "uppercase",
                          letterSpacing: "0.4px",
                          paddingBottom: 8,
                          fontWeight: isActive ? 600 : 400,
                          position: "relative",
                        }}
                      >
                        {tab.label}
                        <span
                          className="mv-tab-underline"
                          style={{ background: this.props.tabAccentColor }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Stack>
          <div style={{ display: "flex", alignItems: "center" }}>
            {primaryItems.map((item) => (
              <TooltipHost content={item.label} key={item.key}>
                <IconButton
                  iconProps={{ iconName: item.iconName }}
                  onClick={item.onClick}
                  disabled={item.disabled}
                  ariaLabel={item.label}
                  styles={{
                    root: {
                      marginLeft: 4,
                      height: 24,
                      width: 24,
                      borderRadius: 4,
                    },
                    flexContainer: { alignItems: "center", justifyContent: "center", height: "100%" },
                    rootHovered: { background: "#F5F5F5", borderRadius: 4 },
                    rootDisabled: { opacity: 0.45 },
                    icon: { fontSize: 16, color: "#242424" },
                  }}
                />
              </TooltipHost>
            ))}
            {secondaryItems.map((item) => (
              <TooltipHost content={item.label} key={item.key}>
                <IconButton
                  iconProps={{ iconName: item.iconName }}
                  onClick={item.onClick}
                  disabled={item.disabled}
                  ariaLabel={item.label}
                  styles={{
                    root: {
                      marginLeft: 4,
                      height: 24,
                      width: 24,
                      borderRadius: 4,
                    },
                    flexContainer: { alignItems: "center", justifyContent: "center", height: "100%" },
                    rootHovered: { background: "#F5F5F5", borderRadius: 4 },
                    rootDisabled: { opacity: 0.45 },
                    icon: { fontSize: 16, color: "#242424" },
                  }}
                />
              </TooltipHost>
            ))}
          </div>
        </div>

            <style>
              {`
                .mv-tab-label { display: inline-block; }
                .mv-tab-underline {
                  position: absolute;
                  left: 0;
                  right: 0;
                  bottom: 0;
                  height: 3px;
                  border-radius: 2px;
                  opacity: 0;
                  transition: opacity 120ms ease-in-out;
                }
                .mv-tab-label.is-active .mv-tab-underline { opacity: 1; }
              `}
            </style>

        {this.state.statusMessage ? (
          <div
            style={{
              padding: "6px 8px",
              borderRadius: "4px",
              background: this.state.statusIntent === "error" ? "#fde7e9" : "#f3f2f1",
              color: this.state.statusIntent === "error" ? "#a4262c" : "#605e5c",
              fontSize: "12px",
            }}
          >
            {this.state.statusMessage}
          </div>
        ) : null}

        {showCodeTab ? (
          <div
            ref={this.codeContainerRef}
            style={{
              position: "relative",
              borderRadius: "6px",
              background: "#ffffff",
              border: "none",
              height: "100%",
              minHeight: 0,
              maxHeight: "none",
              overflow: "hidden",
              width: "100%",
              flex: "1 1 auto",
              boxSizing: "border-box",
            }}
          >
            <pre
              ref={this.lineNumberRef}
              style={{
                margin: 0,
                padding: "10px 8px",
                height: "100%",
                width: "40px",
                overflow: "hidden",
                whiteSpace: "pre",
                textAlign: "right",
                fontFamily: "Consolas, 'Courier New', monospace",
                fontSize: "12px",
                lineHeight: "18px",
                color: "#a19f9d",
                background: "#faf9f8",
                borderRight: "1px solid #edebe9",
                boxSizing: "border-box",
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                userSelect: "none",
                pointerEvents: "none",
              }}
            >
              {lineNumbers}
            </pre>
            <pre
              ref={this.codeHighlightRef}
              style={{
                margin: 0,
                padding: "10px 12px 10px 52px",
                height: "100%",
                overflow: "auto",
                whiteSpace: "pre",
                textAlign: "left",
                fontFamily: "Consolas, 'Courier New', monospace",
                fontSize: "12px",
                lineHeight: "18px",
                color: "#323130",
              }}
              dangerouslySetInnerHTML={{ __html: this.highlightMermaid(this.state.codeValue) }}
            />
            <textarea
              ref={this.codeRef}
              value={this.state.codeValue}
              onChange={(event) => this.handleChange(event.target.value)}
              onScroll={this.handleCodeScroll}
              spellCheck={false}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                resize: "none",
                border: "none",
                outline: "none",
                padding: "10px 12px 10px 52px",
                background: "transparent",
                color: "transparent",
                caretColor: "#323130",
                textAlign: "left",
                fontFamily: "Consolas, 'Courier New', monospace",
                fontSize: "12px",
                lineHeight: "18px",
                whiteSpace: "pre",
                overflow: "auto",
                boxSizing: "border-box",
              }}
            />
            <style>
              {`
                .mm-comment { color: #605e5c; font-style: italic; }
                .mm-diagram { color: #005a9e; font-weight: 600; }
                .mm-keyword { color: #106ebe; font-weight: 600; }
                .mm-string { color: #8e1c24; }
                .mm-number { color: #107c10; }
                .mm-arrow { color: #605e5c; font-weight: 600; }
              `}
            </style>
          </div>
        ) : (
          <>
            <div
              ref={this.previewRef}
              onMouseDown={this.handlePanStart}
              onMouseMove={this.handlePanMove}
              onMouseUp={this.handlePanEnd}
              onMouseLeave={this.handlePanEnd}
              onDoubleClick={this.handleDoubleClick}
              style={{
                minHeight: 0,
                borderRadius: "6px",
                background: "#ffffff",
                border: "none",
                overflow: "hidden",
                width: "100%",
                flex: "1 1 auto",
                cursor: "grab",
                position: "relative",
                userSelect: "none",
              }}
            >
              <div
                ref={this.svgContainerRef}
                style={{
                  transform: `translate(${this.state.panX}px, ${this.state.panY}px) scale(${this.state.zoom})`,
                  transformOrigin: "0 0",
                  display: "inline-block",
                }}
              />
            </div>
            {this.state.error ? (
              <div
                style={{
                  padding: "6px 8px",
                  borderRadius: "4px",
                  background: "#fde7e9",
                  color: "#a4262c",
                  fontSize: "12px",
                  whiteSpace: "pre-wrap",
                }}
              >
                {this.state.error}
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  }
}
