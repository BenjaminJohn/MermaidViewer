import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { IMermaidViewerProps, IMermaidViewerStrings, MermaidViewerView } from "./MermaidViewerView";
import * as React from "react";

export class MermaidViewerMultiple implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;
    private localValue = "";
    private lastContextValue: string | null = null;
    private isDirty = false;

    private handleChange = (nextValue: string): void => {
        this.localValue = nextValue;
        this.isDirty = true;
        this.notifyOutputChanged();
    };

    /**
     * Empty constructor.
     */
    constructor() {
        // Empty
    }

    /**
     * Used to initialize the control instance. Controls can kick off remote server calls and other initialization actions here.
     * Data-set values are not initialized here, use updateView.
     * @param context The entire property bag available to control via Context Object; It contains values as set up by the customizer mapped to property names defined in the manifest, as well as utility functions.
     * @param notifyOutputChanged A callback method to alert the framework that the control has new outputs ready to be retrieved asynchronously.
     * @param state A piece of data that persists in one session for a single user. Can be set at any point in a controls life cycle by calling 'setControlState' in the Mode interface.
     */
    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
    }

    /**
     * Called when any value in the property bag has changed. This includes field values, data-sets, global values such as container height and width, offline status, control metadata values such as label, visible, etc.
     * @param context The entire property bag available to control via Context Object; It contains values as set up by the customizer mapped to names defined in the manifest, as well as utility functions
     * @returns ReactElement root react element for the control
     */
    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const contextValue = context.parameters.mermaidPropertyMultiple.raw ?? "";

        if (this.lastContextValue !== contextValue) {
            this.lastContextValue = contextValue;
            if (!this.isDirty) {
                this.localValue = contextValue;
            }
        }

        if (this.isDirty && contextValue === this.localValue) {
            this.isDirty = false;
        }

        const enFallback: IMermaidViewerStrings = {
            tabDiagram: "Diagram",
            tabCode: "Code",
            tooltipUndo: "Undo",
            tooltipCopySvg: "Copy SVG",
            tooltipDownloadSvg: "Download SVG",
            tooltipFullscreen: "Fullscreen",
            tooltipExitFullscreen: "Exit Fullscreen",
            tooltipOpenInMermaidLive: "Open in mermaid.live",
            statusUndo: "Last change undone.",
            statusSvgCopied: "SVG copied.",
            statusNoSvg: "No SVG available.",
            statusSvgDownloaded: "SVG downloaded.",
            statusFullscreenUnavailable: "Fullscreen not available.",
            statusNoDiagram: "No diagram for mermaid.live.",
            statusPopupBlocked: "Popup blocked.",
            statusCopyUnavailable: "Copy not available.",
        };

        const forceLang = (() => {
            if (typeof window === "undefined") {
                return null;
            }
            const params = new URLSearchParams(window.location.search);
            const value = params.get("forceLang");
            return value ? value.toLowerCase() : null;
        })();
        const forceEnglish = forceLang === "1033" || forceLang === "en" || forceLang === "en-us";

        const getString = (key: string, fallback: string): string => {
            if (forceEnglish) {
                return fallback;
            }
            const value = context.resources.getString(key);
            return value ? value : fallback;
        };

        const strings: IMermaidViewerStrings = {
            tabDiagram: getString("Tab_Diagram", enFallback.tabDiagram),
            tabCode: getString("Tab_Code", enFallback.tabCode),
            tooltipUndo: getString("Tooltip_Undo", enFallback.tooltipUndo),
            tooltipCopySvg: getString("Tooltip_CopySvg", enFallback.tooltipCopySvg),
            tooltipDownloadSvg: getString("Tooltip_DownloadSvg", enFallback.tooltipDownloadSvg),
            tooltipFullscreen: getString("Tooltip_Fullscreen", enFallback.tooltipFullscreen),
            tooltipExitFullscreen: getString("Tooltip_ExitFullscreen", enFallback.tooltipExitFullscreen),
            tooltipOpenInMermaidLive: getString("Tooltip_OpenInMermaidLive", enFallback.tooltipOpenInMermaidLive),
            statusUndo: getString("Status_Undo", enFallback.statusUndo),
            statusSvgCopied: getString("Status_SvgCopied", enFallback.statusSvgCopied),
            statusNoSvg: getString("Status_NoSvg", enFallback.statusNoSvg),
            statusSvgDownloaded: getString("Status_SvgDownloaded", enFallback.statusSvgDownloaded),
            statusFullscreenUnavailable: getString(
                "Status_FullscreenUnavailable",
                enFallback.statusFullscreenUnavailable
            ),
            statusNoDiagram: getString("Status_NoDiagram", enFallback.statusNoDiagram),
            statusPopupBlocked: getString("Status_PopupBlocked", enFallback.statusPopupBlocked),
            statusCopyUnavailable: getString("Status_CopyUnavailable", enFallback.statusCopyUnavailable),
        };

        const props: IMermaidViewerProps = {
            value: this.localValue,
            onChange: this.handleChange,
            strings,
        };
        return React.createElement(MermaidViewerView, props);
    }

    /**
     * It is called by the framework prior to a control receiving new data.
     * @returns an object based on nomenclature defined in manifest, expecting object[s] for property marked as "bound" or "output"
     */
    public getOutputs(): IOutputs {
        return { mermaidPropertyMultiple: this.localValue };
    }

    /**
     * Called when the control is to be removed from the DOM tree. Controls should use this call for cleanup.
     * i.e. cancelling any pending remote calls, removing listeners, etc.
     */
    public destroy(): void {
        // Add code to cleanup control if necessary
    }
}
