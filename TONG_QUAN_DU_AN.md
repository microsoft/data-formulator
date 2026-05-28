# GDIS AI Agent (Data Formulator) — Tài Liệu Tổng Hợp Dự Án

> **Nguồn gốc:** Microsoft Research (tùy biến nội bộ GDIS)
> **Phiên bản:** v0.6.0 (đã hoàn thành Agent UX Triage M0–M6)
> **Giấy phép:** MIT
> **Khẩu hiệu:** _"Vibe with data, in control"_

---

## Mục Lục

1. [Giới Thiệu & Mục Đích](#1-giới-thiệu--mục-đích)
2. [Công Nghệ Sử Dụng](#2-công-nghệ-sử-dụng)
3. [Kiến Trúc Tổng Thể](#3-kiến-trúc-tổng-thể)
4. [Cấu Trúc Thư Mục](#4-cấu-trúc-thư-mục)
5. [Các Tính Năng Chính](#5-các-tính-năng-chính)
6. [Hệ Thống AI Agents](#6-hệ-thống-ai-agents)
7. [API Endpoints](#7-api-endpoints)
8. [Cấu Trúc Dữ Liệu Cốt Lõi](#8-cấu-trúc-dữ-liệu-cốt-lõi)
9. [Luồng Hoạt Động Chính](#9-luồng-hoạt-động-chính)
10. [Triển Khai](#10-triển-khai)
11. [Lịch Sử Phát Triển](#11-lịch-sử-phát-triển)
12. [So Sánh Với Công Cụ Thông Thường](#12-so-sánh-với-công-cụ-thông-thường)

---

## 1. Giới Thiệu & Mục Đích

### 1.1 Tổng Quan

**GDIS AI Agent** là một nền tảng phân tích dữ liệu thông minh, kết hợp AI agents với giao diện người dùng trực quan. Được phát triển dựa trên nghiên cứu của **Microsoft Research**, sau đó được GDIS tùy biến sâu cho nhu cầu giám sát chất lượng (QC) và phân tích kinh doanh trong môi trường sản xuất.

Mục tiêu cốt lõi: **biến dữ liệu thô thành thông tin hữu ích một cách nhanh chóng**, không yêu cầu kỹ năng lập trình từ người dùng.

### 1.2 Ý Nghĩa & Giá Trị

| Giá Trị            | Mô Tả                                                           |
| ------------------ | --------------------------------------------------------------- |
| **Tốc độ**         | Từ dữ liệu thô → biểu đồ chuyên nghiệp trong vài giây           |
| **Kiểm soát**      | Người dùng quyết định hướng phân tích, AI thực thi              |
| **Minh bạch**      | Mọi kết quả AI đều có thể kiểm tra qua code và giải thích       |
| **QC chuyên biệt** | Giám sát chất lượng thời gian thực với biểu đồ kiểm soát        |
| **Dữ liệu lớn**    | Xử lý hàng triệu dòng mượt mà, không lag                        |
| **Toàn diện**      | Từ nạp dữ liệu đến báo cáo cuối cùng trong một công cụ duy nhất |

### 1.3 Đối Tượng Sử Dụng

- Kỹ sư QC / Nhà phân tích chất lượng sản xuất
- Nhà phân tích dữ liệu (Data Analyst)
- Quản lý sản xuất / Giám đốc kỹ thuật
- Nhà nghiên cứu và bất kỳ ai cần hiểu rõ dữ liệu mà không muốn viết code

---

## 2. Công Nghệ Sử Dụng

### 2.1 Frontend (React/TypeScript)

| Công Nghệ                    | Phiên Bản | Vai Trò                    |
| ---------------------------- | --------- | -------------------------- |
| **React**                    | 18.2.0    | Framework UI chính         |
| **TypeScript**               | 4.9.5     | Type-safe JavaScript       |
| **Redux Toolkit**            | latest    | Quản lý state toàn cục     |
| **redux-persist**            | latest    | Lưu state vào localStorage |
| **Material-UI (MUI)**        | v7.1.1    | Component library          |
| **Emotion**                  | latest    | CSS-in-JS styling          |
| **Vega-Lite**                | 5.5.0     | Khai báo biểu đồ           |
| **Vega**                     | 5.32.0    | Render biểu đồ             |
| **react-vega**               | 7.6.0     | Wrapper React cho Vega     |
| **Recharts**                 | 3.6.0     | Biểu đồ thay thế           |
| **react-dnd**                | 16.0.1    | Drag & Drop HTML5          |
| **react-simple-code-editor** | latest    | Hiển thị / edit code       |
| **html2canvas**              | latest    | Chụp màn hình → PNG        |
| **pptxgenjs**                | latest    | Tạo file PowerPoint        |
| **Vite**                     | 5.4.21    | Build tool & dev server    |
| **ESLint**                   | latest    | Linting                    |

### 2.2 Backend (Python/Flask)

| Công Nghệ              | Vai Trò                                                         |
| ---------------------- | --------------------------------------------------------------- |
| **Flask**              | Web framework chính (blueprints cho module hóa)                 |
| **DuckDB**             | Cơ sở dữ liệu columnar cục bộ — xử lý dữ liệu lớn out-of-memory |
| **Redis**              | Session management phía server (tùy chọn)                       |
| **Flask-Session**      | Session store abstraction                                       |
| **LiteLLM**            | Unified API cho OpenAI, Azure, Anthropic, Ollama                |
| **Pandas**             | Xử lý dữ liệu bảng                                              |
| **NumPy**              | Tính toán số học                                                |
| **scikit-learn**       | Thuật toán ML                                                   |
| **BeautifulSoup4**     | Web scraping                                                    |
| **bcrypt**             | Hash mật khẩu                                                   |
| **PyJWT**              | JWT token cho session                                           |
| **python-pptx**        | Tạo file PPTX phía backend                                      |
| **Pillow**             | Xử lý ảnh                                                       |
| **pyodbc**             | Kết nối MSSQL                                                   |
| **clickhouse-connect** | Kết nối ClickHouse                                              |

### 2.3 Kết Nối Dữ Liệu Ngoài

| Hệ Thống        | Mục Đích                           |
| --------------- | ---------------------------------- |
| **MySQL**       | Cơ sở dữ liệu quan hệ              |
| **PostgreSQL**  | Cơ sở dữ liệu quan hệ              |
| **MSSQL**       | SQL Server (qua pyodbc)            |
| **Azure Kusto** | Azure Data Explorer                |
| **Amazon S3**   | Cloud storage (JSON, Parquet, CSV) |
| **Azure Blob**  | Cloud storage                      |
| **ClickHouse**  | Dữ liệu QC thời gian thực          |

### 2.4 Mô Hình AI Được Hỗ Trợ

| Nhà Cung Cấp     | Mô Hình                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| **OpenAI**       | GPT-4o, GPT-4, và các phiên bản khác                                                  |
| **Anthropic**    | Claude 3.5 Sonnet, Claude Opus 4 và các phiên bản khác                                |
| **Azure OpenAI** | Deployment qua **LiteLLM Proxy** (`http://172.19.16.23:4000/v1`) — hiện tại: `gpt-4o` |
| **Ollama**       | Mô hình chạy cục bộ (offline, miễn phí)                                               |

> **Kiến trúc đơn mô hình (Single-Model):** Hệ thống dùng **cùng một model** cho tất cả các tác vụ (từ Prompt Guard đến agents phức tạp). Không còn tầng lightweight model riêng biệt — đơn giản hóa cấu hình và giảm thiểu lỗi.
>
> **Bảo mật API Key:** API key **không bao giờ được gửi xuống frontend**. Model config trả về frontend chỉ chứa `endpoint`, `model`, `api_base`, `api_version`. Backend tự lấy key từ biến môi trường (`AZURE_API_KEY`, v.v.) khi cần.

---

## 3. Kiến Trúc Tổng Thể

### 3.1 Sơ Đồ Kiến Trúc

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          GIAO DIỆN NGƯỜI DÙNG                            │
│                     (React 18 + TypeScript + Redux)                       │
│                                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │  DataLoad   │  │VisualizationV│  │  DataThread │  │  ReportView   │  │
│  │    Chat     │  │  (30+ Charts)│  │  (History)  │  │ (PPTX Export) │  │
│  └─────────────┘  └──────────────┘  └─────────────┘  └───────────────┘  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │  Dashboard  │  │ ChatbotPanel │  │  DataView   │  │  ChartRecBox  │  │
│  └─────────────┘  └──────────────┘  └─────────────┘  └───────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                   Redux Store (dfSlice)                           │    │
│  │  tables | charts | fields | models | dataThreads | messages      │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │ HTTP REST / Server-Sent Events (SSE)
┌───────────────────────────────────▼──────────────────────────────────────┐
│                         BACKEND (Python Flask)                            │
│                                                                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐  │
│  │  Tables  │  │  Agent    │  │  Export  │  │  Auth   │  │ Chatbot  │  │
│  │  Routes  │  │  Routes   │  │  Routes  │  │ Routes  │  │  Routes  │  │
│  └──────────┘  └───────────┘  └──────────┘  └─────────┘  └──────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                      AI AGENTS LAYER (20+ agents)                  │  │
│  │                                                                    │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐   │  │
│  │  │  SQL/Py Transform│  │   Exploration   │  │   Report Gen     │   │  │
│  │  └─────────────────┘  └─────────────────┘  └──────────────────┘   │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐   │  │
│  │  │ Data Clean(SSE) │  │  Prompt Guard   │  │  Code Explanation│   │  │
│  │  └─────────────────┘  └─────────────────┘  └──────────────────┘   │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐   │  │
│  │  │Interactive Expl │  │ Concept Derive  │  │  Data Load/Sort  │   │  │
│  │  └─────────────────┘  └─────────────────┘  └──────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────────┐  │
│  │     DuckDB       │  │    ClickHouse    │  │       LLM APIs         │  │
│  │ (Local columnar) │  │  (QC Realtime)   │  │ OpenAI/Azure/Claude/   │  │
│  │  out-of-memory  │  │  1M row limit    │  │       Ollama           │  │
│  └─────────────────┘  └──────────────────┘  └────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
               ┌────────────────────▼───────────────────┐
               │          Auth Service Nội Bộ            │
               │  Username/Password (bcrypt) + MS SSO   │
               └────────────────────────────────────────┘
```

### 3.2 Luồng Dữ Liệu (Data Flow)

```
Người dùng nhập câu hỏi / kéo thả field
        ↓
Redux dispatch action → dfSlice state update
        ↓
HTTP Request → Flask Route Handler
        ↓
Smart Chat classifier routes prompt to draw/confirm/suggest/info (no semantic hard-block)
        ↓
AI Agent nhận context + prompt → LLM API (LiteLLM)
        ↓
AI trả về SQL/Python code
        ↓
DuckDB / Pandas thực thi code
        ↓
Kết quả JSON / SSE stream → Frontend
        ↓
Redux cập nhật state → React re-render
        ↓
Vega-Lite render biểu đồ
```

### 3.3 Quản Lý State

| Lớp                 | Công Nghệ               | Phạm Vi                                  |
| ------------------- | ----------------------- | ---------------------------------------- |
| **Frontend**        | Redux + redux-persist   | Toàn bộ session UI (localStorage backup) |
| **Backend Session** | Flask + cookie/Redis    | Per-user server state                    |
| **Database tạm**    | DuckDB file per-session | Dữ liệu bảng lớn                         |
| **Model Config**    | .env + Redux state      | API keys, provider, model name           |

---

## 4. Cấu Trúc Thư Mục

```
data-formulator/
│
├── src/                                # React Frontend (46 TSX files)
│   ├── app/
│   │   ├── App.tsx                    # Main app routing
│   │   ├── dfSlice.tsx                # Redux state management (core)
│   │   └── store.ts                   # Redux store setup
│   │
│   ├── views/                          # Màn hình chính (19 TSX)
│   │   ├── DataFormulator.tsx         # Main data exploration interface
│   │   ├── VisualizationView.tsx      # Chart rendering & interaction
│   │   ├── ReportView.tsx             # Report builder & export
│   │   ├── DataView.tsx               # Data table inspector
│   │   ├── DataThread.tsx             # Exploration history management
│   │   ├── Dashboard.tsx              # Dashboard integration
│   │   ├── ChatbotPanel.tsx           # Chat interface
│   │   ├── DataLoadingChat.tsx        # Data ingestion chat
│   │   ├── EncodingShelfThread.tsx    # Visual encoding controls
│   │   ├── ChartRecBox.tsx            # Chart recommendations
│   │   ├── ExampleSessions.tsx        # Example datasets
│   │   ├── LoginPage.tsx              # Authentication UI
│   │   ├── ProtectedRoute.tsx         # Route protection
│   │   └── About.tsx                  # About/Help
│   │
│   ├── components/                     # Reusable components
│   │   ├── ComponentType.tsx          # Type definitions (Chart, FieldItem, DictTable)
│   │   ├── ChartTemplates.tsx         # 30+ chart type configs
│   │   └── FunComponents.tsx          # Utility components
│   │
│   ├── data/                           # Frontend data models
│   │   ├── types.ts                   # Type definitions
│   │   ├── table.ts                   # Table data structure
│   │   └── column.ts                  # Column metadata
│   │
│   └── utils/                          # Frontend utilities
│       └── utils.tsx                  # Shared utilities
│
├── py-src/data_formulator/             # Python Backend (52 PY files)
│   │
│   ├── agents/                         # AI Agent implementations (20+ agents)
│   │   ├── agent_interactive_explore.py    # Gợi ý 4 câu hỏi phân tích
│   │   ├── agent_exploration.py             # Lập kế hoạch multi-step
│   │   ├── agent_sql_data_transform.py      # Sinh SQL code
│   │   ├── agent_py_data_transform.py       # Sinh Python code
│   │   ├── agent_sql_data_rec.py            # Đề xuất biểu đồ (SQL) + pipeline validation
│   │   ├── agent_py_data_rec.py             # Đề xuất biểu đồ (Python) + pipeline validation
│   │   ├── agent_data_load.py               # Trích xuất từ ảnh/text
│   │   ├── agent_data_clean.py              # Làm sạch dữ liệu (full)
│   │   ├── agent_data_clean_stream.py       # Làm sạch (streaming SSE)
│   │   ├── agent_concept_derive.py          # Tạo derived field
│   │   ├── agent_py_concept_derive.py       # Derived field (Python)
│   │   ├── agent_sort_data.py               # Sắp xếp dữ liệu
│   │   ├── agent_code_explanation.py        # Giải thích code
│   │   ├── agent_query_completion.py        # Gợi ý SQL query
│   │   ├── agent_report_gen.py              # Sinh báo cáo
│   │   ├── prompt_guard_agent.py            # Legacy utility (not used for semantic blocking in chart flow)
│   │   ├── qc_chart_config.py               # Cấu hình biểu đồ QC + is_qc_data() strict
│   │   ├── field_metadata.py                # [M1] FieldMeta + compute_field_metadata()
│   │   ├── chart_compatibility.py           # [M2] CHART_REQUIREMENTS + validate_chart()
│   │   ├── chart_defaults.py                # [M2] pick_default_encoding()
│   │   ├── agent_utils.py                   # Shared utilities
│   │   └── client_utils.py                  # LLM client wrapper
│   │
│   ├── tests/                          # Pytest test suite (178 test cases)
│   │   ├── conftest.py                      # In-memory DuckDB fixtures
│   │   ├── test_field_metadata.py           # 37 cases — metadata accuracy
│   │   ├── test_chart_compatibility.py      # 54 cases — reject paths R1-R7
│   │   ├── test_chart_defaults.py           # 36 cases — default picker
│   │   ├── test_qc_detection.py             # 15 cases — is_qc_data() strict
│   │   ├── test_agent_sql_data_rec_pipeline.py  # 15 cases — pipeline integration
│   │   └── test_prompt_structure.py         # 21 cases — prompt slim-down
│   │
│   ├── data_loader/                    # External data connectors (8 loaders)
│   │   ├── external_data_loader.py        # Base class
│   │   ├── mysql_data_loader.py
│   │   ├── postgresql_data_loader.py
│   │   ├── mssql_data_loader.py
│   │   ├── kusto_data_loader.py           # Azure Data Explorer
│   │   ├── s3_data_loader.py
│   │   ├── azure_blob_data_loader.py
│   │   └── qc_data_loader.py              # ClickHouse QC connector
│   │
│   ├── security/                       # Security modules
│   │   └── query_validator.py             # SQL injection prevention
│   │
│   ├── workflows/                      # Complex multi-step workflows
│   │   ├── exploration_flow.py            # Exploration orchestration
│   │   └── create_vl_plots.py             # Vega-Lite plot generation
│   │
│   ├── app.py                          # Flask app init & config
│   ├── agent_routes.py                 # /api/agent/* endpoints
│   ├── tables_routes.py                # /api/tables/* endpoints
│   ├── export_routes.py                # /api/export/* endpoints
│   ├── auth_routes.py                  # /api/auth/* endpoints
│   ├── dashboard_routes.py             # /api/dashboard/* endpoints
│   ├── chatbot_routes.py               # /api/chatbot/* endpoints
│   ├── production_routes.py            # Production environment routes
│   ├── db_manager.py                   # DuckDB session manager
│   ├── py_sandbox.py                   # Python code sandbox
│   └── example_datasets_config.py      # Sample datasets config
│
├── ppt_templates/                      # PowerPoint export templates
├── docs/                               # Documentation
├── public/                             # Static assets
├── scripts/                            # Deployment & utility scripts
├── .devcontainer/                      # Docker dev container
│
├── package.json                        # Node dependencies
├── pyproject.toml                      # Python package metadata
├── requirements.txt                    # Python dependencies
├── tsconfig.json                       # TypeScript config
├── vite.config.ts                      # Vite build config
│
├── docker-compose.yml                  # Multi-container orchestration
├── Dockerfile.frontend
├── Dockerfile.backend
│
├── TONG_QUAN_DU_AN.md                 # Tài liệu tổng hợp (file này)
├── README.md                           # English documentation
├── ARCHITECTURE.md                     # Export flow architecture
├── DEVELOPMENT.md                      # Developer guide
├── DEBUG_GUIDE.md                      # Debugging guide
│
├── .env.sample                         # Environment template
└── api-keys.env.template               # API key template
```

---

## 5. Các Tính Năng Chính

### 5.1 Nạp Dữ Liệu Đa Dạng

| Loại Nguồn                 | Chi Tiết                                          |
| -------------------------- | ------------------------------------------------- |
| **File thông thường**      | CSV, Excel, JSON                                  |
| **Ảnh chụp màn hình**      | AI nhận dạng và trích xuất bảng từ ảnh (OCR-like) |
| **Văn bản lộn xộn**        | Dán text không cấu trúc → AI parse thành bảng     |
| **CSDL quan hệ**           | MySQL, PostgreSQL, MSSQL                          |
| **Cloud / Data Lake**      | S3, Azure Blob, Azure Data Explorer (Kusto)       |
| **ClickHouse (real-time)** | Kết nối trực tiếp analytics DB cho QC             |
| **DuckDB**                 | Xử lý file lớn cục bộ (hàng triệu dòng)           |

### 5.2 Chế Độ QC — Giám Sát Chất Lượng Thời Gian Thực

Tính năng **đặc thù được tùy biến riêng** cho GDIS:

**Tự động nhận diện dữ liệu QC** khi có các cột: `TARGET`, `LL`, `UL`, `ARLL`, `ARUL`

| Cột QC        | Ý Nghĩa                                       |
| ------------- | --------------------------------------------- |
| `TARGET`      | Giá trị mục tiêu                              |
| `LL / UL`     | Giới hạn dưới / trên (Lower/Upper Limit)      |
| `ARLL / ARUL` | Giới hạn cảnh báo nghiêm trọng (Action Limit) |
| `QCDATE`      | Ngày đo                                       |
| `QCSHIFT`     | Ca sản xuất                                   |
| `VALUE`       | Giá trị đo thực tế                            |
| `INDEX`       | Số thứ tự (tự động thêm)                      |

**Biểu đồ QC chuyên biệt:**

| Loại              | Mục Đích                                       |
| ----------------- | ---------------------------------------------- |
| **QC Trend Line** | Theo dõi theo thời gian/ca kèm đường kiểm soát |
| **QC Histogram**  | Phân phối giá trị đo QC                        |
| **QC Trend Bar**  | Xu hướng dạng cột (dữ liệu phân loại)          |

### 5.3 Thư Viện Biểu Đồ (30+ loại)

**Cơ bản:** Bar, Grouped Bar, Stacked Bar, Line, Scatter, Area, Dot Plot, Box Plot, Histogram, Heatmap, Table

**Nâng cao:** Linear Regression, Rolling Average, Threshold, Radial, Bubble, Waterfall, Pyramid

**Phân tích:** Pie/Donut, Pareto, Gauge, Funnel, Treemap, Sankey, Timeline

**QC chuyên biệt:** QC Trend Line, QC Histogram, QC Trend Bar

### 5.4 Hai Chế Độ Khám Phá Dữ Liệu

**Chế độ Interactive (Tương tác):**

- Người dùng nhập câu hỏi bằng ngôn ngữ tự nhiên
- Kéo-thả trường dữ liệu lên các kênh biểu đồ (x, y, color, size, facet...)
- AI gợi ý tự động 4 câu hỏi phân tích (easy → medium → hard)
- AI viết code, tạo biểu đồ, giải thích kết quả

**Chế độ Agent (Tự động nhiều bước):**

- Người dùng đặt mục tiêu cấp cao
- AI lập kế hoạch với **breadth questions** (rộng) + **depth questions** (sâu)
- Streaming từng bước — kết quả hiện ra ngay khi hoàn thành
- Người dùng có thể dừng, điều chỉnh bất cứ lúc nào

### 5.5 Data Threads — Kiểm Soát Hành Trình Phân Tích

- **Lịch sử:** Mỗi bước ghi thành thread có thể xem lại
- **Phân nhánh (Branch):** Tạo hướng mới từ bất kỳ điểm nào, không mất kết quả cũ
- **Quay lui (Backtrack):** Về bước trước, thử hướng khác
- **Neo đậu (Anchor):** Cố định dataset trung gian làm điểm xuất phát mới
- **Join đa bảng:** Kết hợp nhiều bảng, AI xử lý join tự động

### 5.6 Xử Lý Dữ Liệu Lớn

- Mặc định giới hạn **1.000.000 dòng** từ ClickHouse/database
- DuckDB xử lý trực tiếp trên đĩa — không nạp toàn bộ vào RAM
- **Smart Y-axis Domain:** Tự động zoom vào vùng dữ liệu quan trọng
- Streaming kết quả theo thời gian thực (SSE)
- AI sinh SQL query chỉ lấy đúng phần dữ liệu cần — không tải thừa

### 5.7 Kiểm Tra Kết Quả AI

- **Xem code:** Mở Python/SQL mà AI đã viết
- **Xem giải thích:** Logic xử lý bằng ngôn ngữ tự nhiên
- **Xem dữ liệu:** Bảng trung gian được tạo ra
- **Tương tác biểu đồ:** Click, zoom, hover chi tiết

### 5.8 Tạo Báo Cáo & Xuất File

1. Chọn biểu đồ đưa vào báo cáo
2. AI tự viết nội dung phân tích
3. Các định dạng: Blog post, Social post, Executive Summary, Short note
4. **Đa ngôn ngữ:** Tiếng Anh, Việt, Nhật, Lào, Thái
5. **Xuất PowerPoint:** File .pptx với template doanh nghiệp

### 5.9 Pipeline Đề Xuất Biểu Đồ (Chart Recommendation Pipeline)

> **Cập nhật v0.5.2** — đã hoàn thành Milestones M1–M5 theo `KEHOACH_SUA_CHART_RECOMMENDATION.md`.

Trước đây, agent chọn biểu đồ dùng default cứng `x=INDEX, y=VALUE, color=QCSTDPARAMNAME` cho **mọi loại biểu đồ**, dẫn tới các trường hợp vô nghĩa (bar chart với 1000 thanh INDEX, histogram trên sequence, heatmap với INDEX phá lưới…). Phiên bản mới thay bằng **pipeline 3 tầng dựa trên metadata semantic**.

**Sơ đồ pipeline:**

```
Request → [1] compute_field_metadata (DuckDB query gộp)
       → [2] is_qc_data() detect domain (qc | generic)
       → [3] EARLY REJECT (R1/R2/R4) — không gọi LLM
       → [4] Build prompt với FieldMeta hints (đã slim ~40% tokens)
       → [5] LLM trả về encoding
       → [6] POST VALIDATE (R3/R6/R7) — chặn LLM hallucinate
       → [7] Execute SQL → Return result OR rejected_incompatible
```

**FieldMeta (`field_metadata.py`):** dataclass mô tả semantic của 1 cột — `cardinality_class` (low/mid/high/huge), `is_temporal`, `is_sequential`, `is_quantitative`, `is_categorical`, `qc_role` (control_limit/measurement/time/shift/param/slip/item), `looks_like_id`. Tính bằng 1 query DuckDB gộp cho toàn bảng (< 100ms cho 100k rows), cache per-session.

**CHART_REQUIREMENTS (`chart_compatibility.py`):** knowledge base declarative cho ~25 chart types, mỗi chart khai báo `ChannelSpec` cho từng channel (`accept_roles`, `reject_roles`, `soft_priority`, `min/max_distinct`) + `forbidden_channels` + `domain: ["qc"|"generic"]`.

**Reject Code Catalog:**

| Code | Tên ngắn | Trigger | Phát hiện ở |
| ---- | ------------------------- | ------------------------------------------------ | ----------------- |
| R1   | `no_data_fit`             | Required channel không có field nào accept       | Early (no LLM)    |
| R2   | `qc_chart_non_qc_data`    | Chart QC trên data không phải QC                 | Early (no LLM)    |
| R3   | `cardinality_explosion`   | Cardinality vượt `max_distinct_x` (bar > 200)    | Post-validate     |
| R4   | `wrong_dimensionality`    | Không đủ field đúng role (scatter chỉ 1 numeric) | Early (no LLM)    |
| R5   | `duplicate_keys`          | line/area: duplicate (x, color) với y khác       | DuckDB exec layer |
| R6   | `channel_mismatch`        | LLM emit channel bị cấm (pie có x/y)             | Post-validate     |
| R7   | `control_limit_in_encoding` | LLM cho TARGET/LL/UL/ARLL/ARUL vào x/y/color   | Post-validate     |

**QC Detection Strict (S1):** `is_qc_data()` không còn chỉ check `TARGET + limits` mà yêu cầu thêm signature column `{QCDATE, QCSHIFT, QCSTDPARAMNAME, SLIPNO}` → tránh false positive trên data bán hàng có cột "TARGET" (doanh số mục tiêu) + "LL" (low limit budget).

**INDEX Handling (S2):**
- **QC mode:** INDEX là 1st-class field — default x cho line/qc_trend_line khi không có temporal.
- **Generic mode:** INDEX là technical artifact — **không bao giờ** default pick, kể cả cột tên `id`/`row_num`. Phải user explicit chọn.

**Reject Response Contract (S3):** backend trả `status: "rejected_incompatible"` với `reject.reason_code`, `message_vi`, `context_columns`, `suggested_chart_types`, `suggested_actions`. Frontend bắt status → mở **modal blocking** (`ChartIncompatibleModal.tsx`) → user 1-click "Apply suggestion" để chuyển sang chart type khác. **Không tạo Chart object trong Redux khi bị reject** — đảm bảo "thà không vẽ còn hơn vẽ rác".

**Test coverage:** 178 test cases trong `py-src/data_formulator/tests/` (pytest qua `pip install -e ".[dev]"`).

### 5.10 Bảo Mật Đa Lớp

| Lớp Bảo Mật           | Chi Tiết                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Username/Password** | Xác thực API nội bộ, mã hóa bcrypt                                                                         |
| **Microsoft SSO**     | Đăng nhập tài khoản Microsoft doanh nghiệp                                                                 |
| **JWT Token**         | Phiên làm việc mã hóa JWT                                                                                  |
| **Session Store**     | Redis cho session phía server                                                                              |
| **SQL Validator**     | Ngăn SQL injection, file read/write, shell exec                                                            |
| **Prompt Handling**   | Smart Chat routes prompts into `draw/confirm/suggest/info`; no semantic hard-block |
| **API Key Isolation** | API key không bao giờ gửi xuống frontend — backend tự resolve từ env var (`{PROVIDER}_API_KEY`)            |
| **Rate Limiter**      | Giới hạn lượt gọi per-session: 20 req/phút cho `derive-data`, 5 req/phút cho `explore-data`                |
| **Python Sandbox**    | Code AI chạy trong môi trường cách ly                                                                      |

---

## 6. Hệ Thống AI Agents

Ứng dụng sử dụng **20+ AI agents chuyên biệt**, mỗi agent chuyên một nhiệm vụ cụ thể:

| Agent                     | File                           | Nhiệm Vụ                                                                                        |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| **Interactive Explore**   | `agent_interactive_explore.py` | Gợi ý 4 câu hỏi phân tích (easy/medium/hard) + tự nhận diện dữ liệu QC để thêm gợi ý biểu đồ QC |
| **SQL Data Rec**          | `agent_sql_data_rec.py`        | Đề xuất cấu trúc + viết SQL cho biểu đồ (hỗ trợ QC)                                             |
| **Python Data Rec**       | `agent_py_data_rec.py`         | Đề xuất biểu đồ (Python-based)                                                                  |
| **SQL Data Transform**    | `agent_sql_data_transform.py`  | Viết SQL để biến đổi dữ liệu                                                                    |
| **Python Data Transform** | `agent_py_data_transform.py`   | Viết Python để biến đổi dữ liệu                                                                 |
| **Exploration**           | `agent_exploration.py`         | Lập kế hoạch + thực hiện multi-step analysis                                                    |
| **Data Clean**            | `agent_data_clean.py`          | Làm sạch dữ liệu (full response)                                                                |
| **Data Clean Stream**     | `agent_data_clean_stream.py`   | Làm sạch theo ký tự (SSE streaming)                                                             |
| **Data Load**             | `agent_data_load.py`           | Trích xuất từ ảnh, text, URL                                                                    |
| **Concept Derive**        | `agent_concept_derive.py`      | Tạo derived field từ công thức/mô tả                                                            |
| **Python Concept Derive** | `agent_py_concept_derive.py`   | Derived field (Python-based)                                                                    |
| **Sort Data**             | `agent_sort_data.py`           | Sắp xếp dữ liệu theo tiêu chí phân tích                                                         |
| **Code Explanation**      | `agent_code_explanation.py`    | Giải thích code bằng ngôn ngữ tự nhiên                                                          |
| **Query Completion**      | `agent_query_completion.py`    | Gợi ý và hoàn thiện SQL query                                                                   |
| **Report Gen**            | `agent_report_gen.py`          | Viết báo cáo phân tích tự động                                                                  |
| **Prompt Handling**       | `agent_smart_chat.py` + `/smart-chat` | Classify intent and always return actionable suggestions/info                                   |

**Module hỗ trợ Chart Recommendation Pipeline (v0.5.2):**

| Module                    | File                       | Nhiệm Vụ                                                       |
| ------------------------- | -------------------------- | -------------------------------------------------------------- |
| **Field Metadata**        | `field_metadata.py`        | Tính FieldMeta (cardinality/temporal/QC role) từ DuckDB        |
| **Chart Compatibility**   | `chart_compatibility.py`   | CHART_REQUIREMENTS + `validate_chart()` bắt R1–R7              |
| **Chart Defaults**        | `chart_defaults.py`        | `pick_default_encoding()` dựa trên semantic role               |
| **QC Chart Config**       | `qc_chart_config.py`       | `is_qc_data()` strict (yêu cầu signature column) + QC_ROLE_MAP |

### 6.1 Luồng Xử Lý Agent

```
Request → Rate Limiter (per-session) → [429 nếu vượt hạn]
                       ↓ [Trong giới hạn]
         Smart Chat classification / fallback routing
                       ↓ [always continue with actionable route]
              get_lightweight_client() → trả về main_client
              (không có LIGHTWEIGHT_MODEL → dùng cùng một model)
                       ↓
              [DataRec agents only] compute_field_metadata (DuckDB)
                       ↓
              [DataRec agents only] is_qc_data() → domain
                       ↓
              [DataRec agents only] EARLY REJECT R1/R2/R4
                       ↓ [pass]
              Agent chọn context phù hợp (FieldMeta hints)
                       ↓
              LiteLLM → LLM Provider (OpenAI/Azure/Claude/Ollama)
              (Azure: qua LiteLLM Proxy, api_key từ env var)
                       ↓
              Parse response (code / JSON / text / SSE stream)
                       ↓
              [DataRec agents only] POST VALIDATE R3/R6/R7
                       ↓ [pass]
              Execute code (DuckDB SQL / Python sandbox)
                       ↓
              Return result (JSON / SSE stream)
              OR rejected_incompatible → modal frontend
```

**`get_lightweight_client(main_client)`:** Hàm tạo client nhẹ cho tác vụ guard/idea. Đọc `AZURE_LIGHTWEIGHT_MODEL` / `LIGHTWEIGHT_MODEL` env var. Nếu không có → trả về `main_client` (zero-config, kiến trúc đơn mô hình).

---

## 7. API Endpoints

### 7.1 Agent Routes (`/api/agent/*`)

| Endpoint                        | Method   | Mô Tả                          |
| ------------------------------- | -------- | ------------------------------ |
| `/check-available-models`       | GET/POST | Kiểm tra LLM models hoạt động  |
| `/test-model`                   | GET/POST | Test kết nối LLM model         |
| `/process-data-on-load`         | GET/POST | Phân tích ban đầu khi nạp data |
| `/derive-concept-request`       | GET/POST | Tạo derived field (SQL)        |
| `/derive-py-concept`            | GET/POST | Tạo derived field (Python)     |
| `/clean-data`                   | GET/POST | Làm sạch dữ liệu (full)        |
| `/clean-data-stream`            | GET/POST | Làm sạch dữ liệu (SSE stream)  |
| `/sort-data`                    | GET/POST | Sắp xếp dữ liệu                |
| `/derive-data`                  | GET/POST | Biến đổi dữ liệu               |
| `/smart-chat`                   | GET/POST | Unified chart assistant (classify intent + suggest/draw) |
| `/refine-data`                  | GET/POST | Tinh chỉnh dữ liệu             |
| `/code-expl`                    | GET/POST | Giải thích code                |
| `/query-completion`             | POST     | Gợi ý SQL query                |
| `/generate-report-stream`       | GET/POST | Sinh báo cáo (SSE stream)      |

### 7.2 Table Routes (`/api/tables/*`)

| Endpoint                | Method | Mô Tả                        |
| ----------------------- | ------ | ---------------------------- |
| `/list-tables`          | GET    | Danh sách bảng trong session |
| `/upload-file`          | POST   | Upload CSV/Excel             |
| `/external-data-loader` | POST   | Nạp từ database/cloud ngoài  |
| `/get-table`            | GET    | Lấy dữ liệu bảng             |

### 7.3 Export Routes (`/api/export/*`)

| Endpoint          | Method | Mô Tả                         |
| ----------------- | ------ | ----------------------------- |
| `/list-templates` | GET    | Danh sách template PowerPoint |
| `/pptx`           | POST   | Tạo file PowerPoint           |

### 7.4 Auth Routes (`/api/auth/*`)

| Endpoint        | Method | Mô Tả                       |
| --------------- | ------ | --------------------------- |
| `/login`        | POST   | Đăng nhập username/password |
| `/logout`       | GET    | Đăng xuất                   |
| `/current-user` | GET    | Lấy thông tin user hiện tại |
| `/msal-config`  | GET    | Config Microsoft SSO        |

### 7.5 Dashboard Routes (`/api/dashboard/*`)

| Endpoint           | Method | Mô Tả                |
| ------------------ | ------ | -------------------- |
| `/list-dashboards` | GET    | Danh sách dashboards |
| `/get-dashboard`   | GET    | Lấy config dashboard |

### 7.6 Chatbot Routes (`/api/chatbot/*`)

| Endpoint        | Method | Mô Tả             |
| --------------- | ------ | ----------------- |
| `/send-message` | POST   | Gửi tin nhắn chat |
| `/history`      | GET    | Lịch sử chat      |

---

## 8. Cấu Trúc Dữ Liệu Cốt Lõi

### 8.1 DictTable — Biểu Diễn Bảng Dữ Liệu

```typescript
interface DictTable {
  id: string;                    // Table identifier
  displayId: string;             // Tên hiển thị thân thiện
  names: string[];               // Tên các cột
  metadata: {
    [columnName: string]: {
      type: "number" | "string" | "date" | "boolean";
      semanticType: string;      // "measure" | "dimension" | "time"
      levels: any[];             // Các giá trị duy nhất
    }
  };
  rows: any[];                   // Dữ liệu dạng mảng object
  derive?: {                     // Nếu được tính từ bảng khác
    source: string[];
    code: string;                // Code biến đổi (SQL/Python)
    explanation?: {...};
    trigger: Trigger;
  };
  virtual?: {                    // Cho data sources ngoài
    tableId: string;
    rowCount: number;
    loaderParams?: {...};
  };
  anchored: boolean;             // Được cố định làm điểm xuất phát
  createdBy: "user" | "agent";
}
```

### 8.2 Chart — Định Nghĩa Biểu Đồ

```typescript
interface Chart {
  id: string;
  chartType: string; // "bar" | "line" | "scatter" | ...
  encodingMap: {
    [channel: string]: {
      channel: string; // x, y, color, size, opacity, facet...
      field?: FieldItem;
      bin?: boolean;
      aggregate?: string; // "sum" | "mean" | "count" | ...
    };
  };
  tableRef: string; // ID bảng dữ liệu
  chartWidth: number;
  chartHeight: number;
  saved: boolean;
  source: "user" | "trigger";
}
```

### 8.3 Agent Request Context

```json
{
  "table_id": "table-123",
  "instruction": "Show revenue by month",
  "model_config": {
    "endpoint": "openai",
    "model": "gpt-4o",
    "api_key": "sk-...",
    "api_base": "https://api.openai.com/v1"
  },
  "current_data": {
    "names": ["month", "revenue", "product"],
    "rows": [...]
  },
  "exploration_context": [...]
}
```

### 8.4 Redux State (dfSlice)

| State         | Kiểu            | Mô Tả                           |
| ------------- | --------------- | ------------------------------- |
| `tables`      | `DictTable[]`   | Các dataset đang active         |
| `charts`      | `Chart[]`       | Các visualization đang hiển thị |
| `fields`      | `FieldItem[]`   | Derived + original data fields  |
| `models`      | `ModelConfig[]` | AI models & configurations      |
| `modelSlots`  | `ModelSlot[]`   | Phân công model cho từng agent  |
| `dataThreads` | `DataThread[]`  | Lịch sử + nhánh exploration     |
| `messages`    | `Message[]`     | Chat + notification messages    |

---

## 9. Luồng Hoạt Động Chính

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         LUỒNG SỬ DỤNG ĐIỂN HÌNH                         │
└─────────────────────────────────────────────────────────────────────────┘

1. ĐĂNG NHẬP
   ├── Username/Password (xác thực API nội bộ, bcrypt)
   └── Microsoft SSO (tài khoản doanh nghiệp Azure AD)

        ↓

2. NẠP DỮ LIỆU
   ├── Upload file CSV/Excel/JSON
   ├── Kết nối ClickHouse → lọc theo ngày/ca/FACODE/ITEMNAME
   ├── Kết nối database (MySQL, PostgreSQL, MSSQL, Kusto)
   ├── Dán ảnh chụp màn hình → AI OCR trích xuất bảng
   └── Dán văn bản lộn xộn → AI parse thành bảng có cấu trúc

        ↓

3. KHÁM PHÁ DỮ LIỆU
   │
   ├── [Chế Độ QC]
   │   ├── Chọn ngày, ca sản xuất, mã công đoạn, hạng mục
   │   ├── AI tự nhận diện dữ liệu QC (TARGET/LL/UL columns)
   │   └── Tạo QC Trend Line / Histogram với đường control limits
   │
   ├── [Chế Độ Interactive]
   │   ├── Nhập câu hỏi: "Doanh thu theo tháng của từng sản phẩm?"
   │   ├── AI gợi ý 4 câu hỏi phân tích (easy → hard)
   │   ├── Kéo-thả trường dữ liệu lên encoding shelf
   │   └── AI sinh code → thực thi → render biểu đồ
   │
   └── [Chế Độ Agent]
       ├── Đặt mục tiêu: "Phân tích xu hướng bán hàng Q1 2025"
       ├── AI lập kế hoạch (breadth + depth questions)
       └── Streaming từng bước thời gian thực, người dùng kiểm soát

        ↓

4. KIỂM TRA KẾT QUẢ
   ├── Xem code Python/SQL mà AI đã viết
   ├── Đọc giải thích logic xử lý bằng ngôn ngữ tự nhiên
   ├── Xem bảng dữ liệu trung gian được tạo ra
   └── Tương tác trực tiếp với biểu đồ (zoom, hover, click)

        ↓

5. QUẢN LÝ HÀNH TRÌNH (Data Threads)
   ├── Xem lại toàn bộ lịch sử phân tích
   ├── Phân nhánh để thử hướng mới, không mất kết quả cũ
   ├── Quay lui về bất kỳ bước nào trước đó
   └── Anchor dữ liệu trung gian làm điểm xuất phát mới

        ↓

6. TẠO BÁO CÁO & CHIA SẺ
   ├── Chọn biểu đồ đưa vào báo cáo
   ├── AI viết nội dung phân tích tự động (đa ngôn ngữ)
   ├── Chọn phong cách: blog / executive summary / social / short note
   └── Xuất file PowerPoint (.pptx) với template doanh nghiệp
```

### 9.1 Ví Dụ: Luồng Tạo Biểu Đồ Interactive

```
1. Người dùng kéo field "month" → trục X, "revenue" → trục Y
2. Gõ: "Chia theo sản phẩm, hiển thị xu hướng"
3. Frontend gửi POST /api/agent/derive-data
4. Smart Chat classifies prompt and routes to actionable flow (draw/confirm/suggest/info)
5. SQL/Python Data Rec Agent → chọn "line" chart + GROUP BY product
6. SQL Transform Agent → sinh SQL: SELECT month, product, SUM(revenue) ...
7. DuckDB thực thi query → trả về JSON
8. Frontend Redux update → Vega-Lite render line chart
9. Code Explanation Agent giải thích logic (optional)
```

### 9.2 Ví Dụ: Luồng Xuất PowerPoint

```
1. Người dùng chọn biểu đồ cần đưa vào báo cáo
2. Frontend gọi GET /api/export/list-templates
3. Người dùng chọn template
4. html2canvas chụp màn hình báo cáo → PNG buffer
5. POST /api/export/pptx với PNG + template name
6. Backend python-pptx chèn ảnh vào slide template
7. Lưu file PPTX → trả về cho browser download
```

---

## 10. Triển Khai

### 10.1 Development (Local)

```bash
# Backend
pip install -r requirements.txt
python -m data_formulator

# Frontend (cửa sổ riêng)
npm install
npm run dev
```

### 10.2 Python Package

```bash
pip install data_formulator
python -m data_formulator
# → Mở tại http://localhost:5000
```

### 10.3 Docker Compose (Production)

```yaml
# docker-compose.yml
services:
  redis: # Session store
  backend: # Flask API server
  frontend: # React static files
```

```bash
docker-compose up -d
```

### 10.4 Environment Configuration

```env
# api-keys.env (cấu hình hiện tại của GDIS)
# ─── Azure (qua LiteLLM Proxy) ───
AZURE_ENABLED=true
AZURE_API_KEY=sk-xxxx                        # Proxy API key
AZURE_API_BASE=http://172.19.16.23:4000/v1   # LiteLLM Proxy URL
AZURE_API_VERSION=2024-10-21
AZURE_MODELS=gpt-4o                          # Dùng chung cho mọi tác vụ
# AZURE_LIGHTWEIGHT_MODEL=                   # Để trống = single-model mode

# ─── Các provider khác (tuỳ chọn) ───
# OPENAI_ENABLED=true
# OPENAI_API_KEY=sk-...
# OPENAI_MODELS=gpt-4o,gpt-4-turbo

# ANTHROPIC_ENABLED=true
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODELS=claude-3-5-sonnet-20241022

# OLLAMA_ENABLED=true
# OLLAMA_API_BASE=http://localhost:11434
# OLLAMA_MODELS=llama3,mistral

# ─── Database QC ───
CLICKHOUSE_HOST=...
CLICKHOUSE_PORT=8123

# ─── Auth ───
AUTH_API_URL=http://...
MSAL_CLIENT_ID=...
MSAL_TENANT_ID=...

# ─── Session ───
# REDIS_HOST=127.0.0.1    # Để trống = cookie-based session
# REDIS_PORT=6379
```

---

## 11. Lịch Sử Phát Triển

| Phiên Bản          | Tháng/Năm | Tính Năng Nổi Bật                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1 (Initial)** | 10/2024   | Ra mắt: phân tích NL + kéo thả                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **v0.1.6**         | 02/2025   | Multi-table + auto join                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **v0.1.7**         | 03/2025   | Dataset anchoring                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **v0.2**           | 04/2025   | DuckDB — xử lý dữ liệu lớn                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **v0.2.1**         | 05/2025   | External Data Loader (MySQL, PostgreSQL, Kusto, S3, Azure Blob)                                                                                                                                                                                                                                                                                                                                                                                                               |
| **v0.2.2**         | 07/2025   | Goal-driven exploration + gợi ý câu hỏi tự động                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **v0.5**           | 11/2025   | Agent mode + Interactive control                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Custom GDIS**    | 2025–2026 | QC Mode, Auth SSO, Dashboard, Smart Y-axis, Smart Chat routing, PPTX Export                                                                                                                                                                                                                                                                                                                                                                                                    |
| **v0.5.1**         | 05/2026   | **Security:** API key không gửi frontend, backend resolve từ env var · **Single-model:** bỏ lightweight model tier · **Rate limiter:** 20 req/min cho derive-data, 5 req/min cho explore-data · **QC Ideas:** InteractiveExploreAgent tự nhận diện QC data và gợi ý biểu đồ QC · **IdeaChip:** selector loại biểu đồ, isQcData frontend · **Redux fix:** cache clearing khi reset/load state · **Bug fix:** Flask child process stale state gây mất 4 ideas (fix bằng reload) |
| **v0.5.2**         | 05/2026   | **Chart Recommendation Pipeline (M1–M5):** thay default cứng `x=INDEX/y=VALUE` bằng FieldMeta semantic · **M1:** `field_metadata.py` (FieldMeta dataclass + DuckDB query gộp) · **M2:** `chart_compatibility.py` (CHART_REQUIREMENTS knowledge base + validate_chart) + `chart_defaults.py` (pick_default_encoding) · **M3:** integrate pipeline 3 tầng vào agent_sql_data_rec (early reject → LLM → post validate), `is_qc_data()` strict yêu cầu signature column · **M4:** prompt slim down ~40% tokens, thay hardcoded defaults bằng FieldMeta hints · **M5:** `ChartIncompatibleModal.tsx` modal blocking + parity cho `agent_py_data_rec.py` · **Reject codes R1–R7:** no_data_fit / qc_chart_non_qc_data / cardinality_explosion / wrong_dimensionality / duplicate_keys / channel_mismatch / control_limit_in_encoding · **Tests:** pytest suite 178 cases tại `py-src/data_formulator/tests/` |
| **v0.6.0**         | 05/2026   | **Agent UX Triage (M0–M6):** bỏ Agent Mode, chuyển interactive-only; thêm backend `chart_template_registry.py`, `drawable_catalog.py`, `prompt_classifier.py`, endpoint `/api/agent/smart-chat`; enforce template constraints R8/R9; thay `ChartIncompatibleModal` bằng `ChartAssistantModal` 4 mode (REJECT/SUGGESTION/CONFIRM/INFO) + `ChartThumbnail`/`SuggestionGrid`; thêm onboarding one-time theo domain QC/generic; thêm telemetry events `prompt_classified` / `suggestion_clicked` / `modal_closed_no_action`; bổ sung test smart-chat + telemetry endpoint; build/test pass và commit theo mốc M0→M6. |
| **v0.6.1**         | 05/2026   | **Smart Chat refinement + Prompt Customization UX:** cải thiện nhận diện ý định chart linh hoạt theo biến thể nhập liệu; chuẩn hóa mapping tên chart display/internal để tránh lỗi "unsupported chart" sau khi chọn gợi ý; tăng chất lượng rationale gợi ý theo hướng nêu mục tiêu phân tích; bổ sung ô **Customize your prompt** trong `ChartAssistantModal` và luồng submit custom prompt end-to-end ở `ChartRecBox` (sửa prompt rồi gửi vẽ ngay). |

---

## 12. So Sánh Với Công Cụ Thông Thường

| Tiêu Chí               | Công Cụ BI Thông Thường               | GDIS AI Agent                          |
| ---------------------- | ------------------------------------- | -------------------------------------- |
| **Yêu cầu kỹ thuật**   | Cần SQL, Python, hoặc UI phức tạp     | Chỉ ngôn ngữ tự nhiên                  |
| **Tốc độ**             | Vài giờ để setup biểu đồ phức tạp     | Vài giây                               |
| **Kiểm soát**          | Người dùng thao tác trực tiếp mọi thứ | AI làm — người dùng kiểm soát hướng    |
| **Minh bạch**          | Ẩn logic tính toán                    | Hiển thị code + giải thích từng bước   |
| **Nguồn dữ liệu**      | Thường cần cấu hình phức tạp          | Đa dạng, kể cả ảnh và text             |
| **Dữ liệu lớn**        | Thường lag với dữ liệu lớn            | DuckDB + SQL sampling thông minh       |
| **QC chuyên biệt**     | Cần công cụ riêng                     | Tích hợp sẵn, tự nhận diện             |
| **Phân tích nâng cao** | Yêu cầu chuyên môn sâu                | AI tự đề xuất và thực hiện             |
| **Bảo mật**            | Cơ bản                                | JWT, SSO, SQL validation, rate limiting |
| **Báo cáo**            | Export thủ công                       | AI viết nội dung + xuất PPTX tự động   |

---

## Tóm Tắt Nhanh

**GDIS AI Agent là gì?**
Nền tảng phân tích dữ liệu thông minh (nguồn gốc Microsoft Research, được GDIS tùy biến sâu), giúp bất kỳ ai — không cần kỹ năng lập trình — có thể khám phá dữ liệu, giám sát chất lượng QC thời gian thực, tạo biểu đồ chuyên nghiệp và viết báo cáo phân tích chỉ bằng ngôn ngữ tự nhiên.

**Stack tóm gọn:** React 18 + TypeScript + Redux + Vega-Lite | Python Flask + DuckDB + LiteLLM

**Đặc điểm nổi bật:**

- AI sinh SQL/Python code — người dùng kiểm tra và kiểm soát
- QC Mode với biểu đồ kiểm soát (control limits) thời gian thực
- 20+ specialized agents, mỗi agent một nhiệm vụ cụ thể
- **Chart Recommendation Pipeline (v0.5.2):** validate dựa trên FieldMeta semantic, reject sớm R1–R7, modal blocking thay vì "fallback im lặng"
- Streaming responses cho trải nghiệm thời gian thực
- Hỗ trợ mọi LLM lớn qua LiteLLM (OpenAI, Azure, Claude, Ollama)

## 13. Latest Updates (2026-05-26)

### 13.1 Suggestion-to-Draw Consistency

- Unified ideas/suggestions flow via `/api/agent/smart-chat` (legacy `/get-recommendation-questions` removed).
- When user clicks a suggestion, frontend now sends:
  - `user_preferred_chart_type`
  - `chart_type`
  - `chart_encodings` (from suggestion, sanitized)
- This prevents mismatch where suggestion says one chart (e.g., Boxplot) but draw step validates as another chart type.

### 13.2 Template Channel Handling

- For non-QC charts:
  - Unsupported channels are auto-pruned instead of immediate reject (R9 soft recovery).
  - Blank channel assignments (e.g., `size: ""`) are removed before validation.
- For QC special charts (`QC Trend Line`, `QC Histogram`, `QC Trend Bar`):
  - Channel constraints remain strict (no auto-remap/auto-prune beyond fixed QC rules).

### 13.3 UX Cleanup

- Idea chips:
  - Removed chart-type dropdown in chip UI.
  - Clicking an idea uses the predicted/suggested chart type directly.
  - Idea text color adjusted to reduce visual glare.

### 13.4 Validation Outcome

- Goal: suggestions shown to users should be executable with current chart templates/channels.
- Recent fixes specifically addressed failures like:
  - `Boxplot` suggestion failing due to unsupported `size` channel.
  - `Column '' does not exist in the data` from empty encoding values.

## 14. Latest Updates (2026-05-28)

### 14.1 Data Sample Context — SmartChatAgent nhìn thấy nội dung dữ liệu thực tế

`SmartChatAgent` đã được làm giàu context với 2 lớp thông tin mới:

**`sample_values`** — giá trị thực tế trong cột categorical/temporal cardinality thấp (≤ 12 giá trị):
```
- product [categorical] cards=3(low) values=[iPhone, Samsung, Oppo] → ideal for grouping/color
- QCSHIFT [categorical] cards=3(low) values=[CA1, CA2, CA3] → ideal for grouping/color
```

**`sample_rows`** — 3 dòng đại diện (đầu + giữa + cuối) dạng markdown table:
```
| month   | product | region  | revenue |
| 2024-01 | iPhone  | Hà Nội  | 120000  |
| 2024-03 | Samsung | Đà Nẵng | 112000  |
| 2024-06 | Oppo    | TP.HCM  | 89000   |
```

**Kết quả:** Agent sinh `message_vi` có ngữ nghĩa cụ thể thay vì canned text chung chung:
- Trước: *"Dựa trên dữ liệu của bạn, đây là các biểu đồ có thể vẽ ngay."*
- Sau: *"Data tracks sales of 3 phone brands (iPhone, Samsung, Oppo) over 6 months across 3 regions."*

**Files đã thay đổi:**
- `field_metadata.py`: `FieldMeta.sample_values` + DuckDB query populate cho categorical & temporal.
- `agent_routes.py`: `_extract_sample_rows()`, `_truncate_cell()`, `_safe_serialize()` + populate `sample_values` trong pandas path + truyền `sample_rows` vào `agent.run()`.
- `agent_smart_chat.py`: `_build_column_profile()` hiển thị `values=[...]`, `_build_data_sample_section()` format markdown, `_build_system_prompt()` embed DATA SAMPLE section, `SmartChatAgent.run()` nhận `field_metas` + `sample_rows`.

Chi phí thêm: ~180–320 tokens/request (~15–20% tổng prompt — không đáng kể).
