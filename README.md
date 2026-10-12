# aaPanel MCP Server

MCP server này cho phép Claude (Claude Code, Claude Desktop) quản trị máy chủ aaPanel thông qua API của panel. Server chạy trên máy tính của bạn qua stdio, và chỉ panel được nhận API key.

## Công cụ

| Nhóm | Chỉ đọc (luôn bật) | Ghi (`AAPANEL_ALLOW_WRITE=1`) |
|---|---|---|
| Hệ thống | `system_status`, `panel_logs`, `aapanel_permissions` | `service_control` (nginx, mysqld, php-fpm-XX, redis…) |
| Website | `list_sites`, `list_site_domains`, `site_logs`, `list_php_versions`, `get_site_php_version`, `list_backups` | `create_site`, `set_site_running`, `add_site_domains`, `remove_site_domain`, `set_site_php_version`, `set_force_https`, `backup_site`, `delete_site`* |
| File | `list_dir`, `read_file`, `path_size`, `download_file` | `write_file`, `create_dir`, `move_path`, `copy_path`, `compress`, `extract`, `set_permissions`, `upload_file`, `fetch_url_to_server`, `delete_path`* |
| MySQL | `list_databases` (ẩn mật khẩu), `mysql_info` | `create_database`, `backup_database`, `import_sql`, `set_database_password`, `delete_database`* |
| Cron | `list_cron_jobs`, `cron_job_log` | `run_cron_job`, `toggle_cron_job`, `delete_cron_job`* |
| Firewall | `list_firewall_rules` | `open_port`, `block_ip`, `remove_firewall_rule`* |

Một số công cụ chỉ bật khi bạn cho phép thêm:
- **Shell** (bật bằng `AAPANEL_ALLOW_SHELL=1`):
  - `run_command`: chạy lệnh bash với quyền root, trả về output và exit code. Lệnh chạy qua `files?action=ExecShell` của panel.
  - `add_cron_shell_job`: tạo cron job chạy script shell.
- **API thô** (bật bằng `AAPANEL_ALLOW_RAW=1`):
  - `api_call`: gọi bất kỳ action nào của panel, ví dụ SSL, redirect, proxy, cấu hình PHP.

Các công cụ có dấu `*` sẽ xóa dữ liệu. Muốn chạy, phải truyền `confirm` đúng bằng tên site, database, đường dẫn, port hoặc IP cần xóa.

## Cơ chế an toàn

- **Phân quyền:** mặc định server chỉ đọc. Phải bật thêm `AAPANEL_ALLOW_WRITE`, `AAPANEL_ALLOW_SHELL`, `AAPANEL_ALLOW_RAW` thì các công cụ tương ứng mới hiện ra.
- **Giới hạn file trên server:** công cụ file chỉ làm việc trong `AAPANEL_PATHS` (mặc định `/www`). Đường dẫn chứa `..` bị từ chối. File nội bộ của panel (`/www/server/panel`, nơi lưu API key và database của panel) bị chặn, riêng thư mục `vhost` (cấu hình nginx/apache) vẫn được phép.
- **Giới hạn file trên máy bạn:** upload chỉ đọc file, và download chỉ ghi file, trong `AAPANEL_LOCAL_DIRS`.
- **Lệnh shell không bị giới hạn thư mục.** `run_command` chạy với quyền root và không bị `AAPANEL_PATHS` chặn. Vì vậy chỉ bật `AAPANEL_ALLOW_SHELL` khi bạn tin tưởng và đọc kỹ từng lệnh trước khi duyệt.
- **Bảo vệ API key:** key không bao giờ được gửi đi nguyên văn. Mỗi request chỉ gửi `request_token = md5(request_time + md5(key))`.
- **Bảo vệ mật khẩu database:** khi liệt kê database, mật khẩu đã lưu bị thay bằng `••••`.

## Cài đặt

Cần Node.js 20 trở lên.

```bash
npm install
npm run build
npm test
```

`npm test` chạy thử toàn bộ công cụ trên một panel giả lập, không chạm vào server thật.

### 1. Bật API trên aaPanel

Vào **aaPanel → Settings → API interface**:
1. Bật API.
2. Copy **API key**.
3. Thêm **IP công khai của máy bạn** vào whitelist. Xem IP của bạn tại https://ifconfig.me.

Lưu ý:
- IP nhà thường thay đổi. Khi IP đổi, bạn phải cập nhật lại whitelist.
- Sai token 20 lần liên tiếp thì IP bị panel khóa 1 giờ.

### 2. Thêm vào Claude Code

Tự chạy lệnh dưới đây và tự dán API key vào chỗ `<API_KEY>`. Đừng dán key vào chat.

```bash
claude mcp add aapanel --scope user \
  -e AAPANEL_URL=https://your-server-ip:8888 \
  -e AAPANEL_API_KEY=<API_KEY> \
  -e AAPANEL_INSECURE_TLS=1 \
  -e AAPANEL_ALLOW_WRITE=1 \
  -e AAPANEL_LOCAL_DIRS=/path/to/local/folder \
  -- node /path/to/aapanel-mcp/dist/index.js
```

- `AAPANEL_URL` là địa chỉ gốc của panel. **Không** thêm đường dẫn bảo mật kiểu `/abc123`.
- Chỉ thêm `-e AAPANEL_ALLOW_SHELL=1` nếu bạn muốn cho Claude chạy lệnh shell.
- Kiểm tra kết nối bằng `claude mcp list`, rồi hỏi Claude "Server của tôi đang thế nào?".

### 3. Claude Desktop (tùy chọn)

Thêm đoạn sau vào `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aapanel": {
      "command": "node",
      "args": ["/path/to/aapanel-mcp/dist/index.js"],
      "env": {
        "AAPANEL_URL": "https://your-server-ip:8888",
        "AAPANEL_API_KEY": "<API_KEY>",
        "AAPANEL_INSECURE_TLS": "1",
        "AAPANEL_ALLOW_WRITE": "1"
      }
    }
  }
}
```

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `AAPANEL_URL` | bắt buộc | Địa chỉ gốc của panel, ví dụ `https://1.2.3.4:8888` |
| `AAPANEL_API_KEY` | bắt buộc | API key lấy từ Settings → API interface |
| `AAPANEL_INSECURE_TLS` | `0` | Đặt `1` khi panel dùng chứng chỉ tự ký. Chỉ áp dụng cho kết nối tới panel |
| `AAPANEL_ALLOW_WRITE` | `0` | Bật các công cụ thay đổi dữ liệu |
| `AAPANEL_ALLOW_SHELL` | `0` | Bật `run_command` và `add_cron_shell_job` (chạy với quyền root) |
| `AAPANEL_ALLOW_RAW` | `0` | Bật `api_call` |
| `AAPANEL_PATHS` | `/www` | Các thư mục trên server mà công cụ file được dùng, phân cách bằng dấu phẩy |
| `AAPANEL_LOCAL_DIRS` | thư mục hiện tại | Các thư mục trên máy bạn dùng cho upload và download |
| `AAPANEL_TIMEOUT_MS` | `60000` | Thời gian chờ tối đa cho mỗi request |

## Ghi chú

- **Mức độ tương thích:** tên action và tham số được lấy từ mã nguồn aaPanel (`class/files.py`, `panelSite.py`, `database.py`, `crontab.py`, `system.py`, `firewalls.py`) và từ MCP chính thức của aaPanel. Bộ kiểm thử chạy trên panel giả lập, nên có thể có action khác biệt nhỏ tùy phiên bản panel. Khi gặp trường hợp đó, công cụ trả về đúng thông báo lỗi của panel.
- **Lệnh shell:** `run_command` ghi output ra `/tmp/aapanel-mcp-*.log` và xóa file sau khi lệnh chạy xong. Panel chỉ có một khe chạy shell, nên các lệnh được chạy lần lượt. Lệnh chạy quá `timeout_seconds` vẫn tiếp tục chạy nền trên server.
