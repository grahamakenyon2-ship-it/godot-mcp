@tool
extends EditorPlugin

const AUTOLOADS: Array[Array] = [
	["autoload/MCPRuntimeBridge", "res://addons/godot_mcp/services/mcp_runtime_bridge.gd"],
	["autoload/MCPInputBridge", "res://addons/godot_mcp/services/mcp_input_bridge.gd"],
	["autoload/MCPScreenshotBridge", "res://addons/godot_mcp/services/mcp_screenshot_bridge.gd"],
]

var _websocket_client: Node
var _command_router: Node
var _injected: Array[String] = []
var auto_dismiss_dialogs: bool = false


func _enter_tree() -> void:
	_maybe_launch_relay_bridge()
	_inject_autoloads()
	_command_router = preload("res://addons/godot_mcp/command_router.gd").new()
	_command_router.name = "MCPCommandRouter"
	_command_router.editor_plugin = self
	add_child(_command_router)

	_websocket_client = preload("res://addons/godot_mcp/websocket_client.gd").new()
	_websocket_client.name = "MCPWebSocketClient"
	_websocket_client.command_router = _command_router
	add_child(_websocket_client)
	_websocket_client.start()
	print("[Godot MCP] Plugin started")


func _exit_tree() -> void:
	_remove_autoloads()
	if _websocket_client:
		_websocket_client.stop()
		_websocket_client.queue_free()
	if _command_router:
		_command_router.queue_free()
	print("[Godot MCP] Plugin stopped")


# ---------------------------------------------------------------------------
# Relay bridge auto-start (fork addition)
# Reads %APPDATA%/godot-relay/config.json -> { "bridge_dir": "..." } and, if no
# MCP server is listening on the relay port yet, spawns the GitHub relay
# bridge (node bridge.mjs) in the background. Token is read by the bridge from
# relay-token.txt next to bridge.mjs (gitignored), so nothing to type.
# ---------------------------------------------------------------------------

func _maybe_launch_relay_bridge() -> void:
	if OS.get_name() != "Windows":
		return
	var config := _load_relay_config()
	if config.is_empty():
		return
	var bridge_dir: String = config.get("bridge_dir", "")
	if bridge_dir.is_empty():
		push_warning("[Godot MCP] relay config.json missing bridge_dir")
		return
	if not DirAccess.dir_exists_absolute(bridge_dir):
		push_warning("[Godot MCP] relay bridge_dir does not exist: " + bridge_dir)
		return
	var port := _relay_port()
	if _port_is_listening(port):
		print("[Godot MCP] relay bridge already running on port %d" % port)
		return
	var script_path: String = bridge_dir.path_join("bridge.mjs")
	var pid := OS.create_process("node", [script_path], false)
	if pid == -1:
		push_warning("[Godot MCP] could not launch relay bridge (is node on PATH?)")
	else:
		print("[Godot MCP] relay bridge launched in background (pid %d)" % pid)


func _relay_port() -> int:
	if OS.has_environment("GODOT_MCP_PORT"):
		return int(OS.get_environment("GODOT_MCP_PORT"))
	return 6505


func _load_relay_config() -> Dictionary:
	var appdata := OS.get_environment("APPDATA")
	if appdata.is_empty():
		return {}
	var path := appdata.path_join("godot-relay").path_join("config.json")
	if not FileAccess.file_exists(path):
		return {}
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var json := JSON.new()
	if json.parse(f.get_as_text()) != OK:
		push_warning("[Godot MCP] could not parse " + path)
		return {}
	if json.data is Dictionary:
		return json.data
	return {}


func _port_is_listening(port: int) -> bool:
	var output: Array = []
	OS.execute("netstat", ["-ano"], output, false, false)
	var text := ""
	if output.size() > 0:
		text = str(output[0])
	var needle := ":%d" % port
	for line in text.split("\n"):
		var t := line.strip_edges()
		if t.contains(needle) and t.to_lower().contains("listening"):
			return true
	return false


func _process(_delta: float) -> void:
	if not auto_dismiss_dialogs:
		return
	var base_control := get_editor_interface().get_base_control()
	if base_control:
		_dismiss_dialogs(base_control)


func _dismiss_dialogs(node: Node) -> void:
	if node is AcceptDialog and node.visible:
		node.hide()
	for child in node.get_children():
		_dismiss_dialogs(child)


func _inject_autoloads() -> void:
	_injected.clear()
	var changed := false
	for entry in AUTOLOADS:
		var key: String = entry[0]
		var script: String = entry[1]
		if not ProjectSettings.has_setting(key):
			ProjectSettings.set_setting(key, "*" + script)
			_injected.append(key)
			changed = true
	if changed:
		ProjectSettings.save()


func _remove_autoloads() -> void:
	var changed := false
	for key in _injected:
		if ProjectSettings.has_setting(key):
			ProjectSettings.set_setting(key, null)
			changed = true
	_injected.clear()
	if changed:
		ProjectSettings.save()
