// TerryXu frontend entrypoint.
// ComfyUI auto-loads only this .js file from WEB_DIRECTORY; implementation
// modules use .mjs so their initialization order is controlled explicitly here.

// Generic utilities / independent features
import "./bool_switch_subgraph_bridge.mjs";
import "./date_formatter_hint.mjs";
import "./file_save.mjs";
import "./file_save_native_preview_layout.mjs";
import "./file_save_panel_ui.mjs";

// Group manager stack
import "./group_manager.mjs";
import "./group_manager_external_bool.mjs";
import "./group_manager_subgraph_service.mjs";
import "./group_manager_ui_classic.mjs";
import "./group_membership_fix.mjs";

// H3 editor stack
import "./h3_bus_resolver.mjs";
import "./h3_kjnodes_bridge.mjs";
import "./h3_native_wire_bus.mjs";
import "./h3_prompt_editor.mjs";
import "./h3_prompt_editor_view_stability.mjs";
import "./h3_prompt_layout.mjs";
import "./h3_prompt_view_toggle.mjs";
import "./h3_rich_text.mjs";
import "./h3_shared_menus.mjs";
import "./h3_shot_timeline.mjs";
import "./h3_text_preview_mode.mjs";
import "./h3_time_range.mjs";
import "./h3_timeline_parser.mjs";
import "./h3_transport_and_rebind.mjs";
import "./h3_ui_i18n.mjs";
import "./h3_virtual_media_disconnect.mjs";

// Switches / linked state / remote control
import "./line_switch.mjs";
import "./linked_boolean.mjs";
import "./linked_boolean_sync.mjs";
import "./linked_boolean_ui.mjs";
import "./remote_control_output.mjs";
import "./remote_control_sync.mjs";
import "./remote_control_ui.mjs";
import "./switch_ui.mjs";
import "./switch_wire_highlight.mjs";

// Other visual tools
import "./video_compare.mjs";
import "./wire_bus.mjs";
import "./wire_bus_named_ports.mjs";
import "./wire_bus_visual.mjs";
