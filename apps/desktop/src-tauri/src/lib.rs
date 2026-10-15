mod host_cmd;
mod host_fs;
mod host_ssh;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            host_fs::host_stat,
            host_fs::host_ls,
            host_fs::host_read,
            host_fs::host_write,
            host_fs::host_delete,
            host_fs::host_move,
            host_cmd::host_open,
            host_cmd::host_screenshot,
            host_cmd::host_open_privacy,
            host_cmd::host_shell,
            host_cmd::host_device_name,
            host_cmd::host_machine_id,
            host_ssh::host_ssh_probe,
            host_ssh::host_ssh_ls,
            host_ssh::host_ssh_read,
            host_ssh::host_ssh_write,
            host_ssh::host_ssh_delete,
            host_ssh::host_ssh_exec,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Bot");
}
