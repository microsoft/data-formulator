# GDIS AI Agent — Báo Cáo Chức Năng & Lợi Ích

> **Dự án:** GDIS AI Agent (Data Formulator)
> **Phiên bản:** v0.5.1
> **Ngày cập nhật:** 05/2026
> **Đối tượng:** Ban lãnh đạo / Cấp quản lý

---

## Tóm Tắt

**GDIS AI Agent** là công cụ phân tích dữ liệu thông minh được triển khai nội bộ tại GDIS, cho phép nhân viên **tự khai thác và trực quan hóa dữ liệu** bằng ngôn ngữ tự nhiên — không cần biết lập trình, không cần chờ đội kỹ thuật.

Công cụ đóng vai trò **trợ lý phân tích dữ liệu cá nhân** cho từng người dùng, giúp rút ngắn thời gian từ câu hỏi kinh doanh đến biểu đồ/báo cáo từ **nhiều ngày xuống còn vài phút**.

---

## Tại Sao Cần Công Cụ Này?

### Vấn Đề Thực Tế

Ngày nay, các công cụ AI phân tích dữ liệu như **ChatGPT, Gemini, Copilot** rất mạnh nhưng có một rủi ro nghiêm trọng: khi nhân viên tải dữ liệu sản xuất, dữ liệu khách hàng, hay số liệu kinh doanh lên các dịch vụ này, **dữ liệu có thể bị lưu trữ và sử dụng bởi bên thứ ba** — vi phạm chính sách bảo mật thông tin của doanh nghiệp.

Đồng thời, các công cụ thông thường như Excel, Power BI đòi hỏi kỹ năng chuyên sâu và mất nhiều thời gian, trong khi phòng IT luôn quá tải với các yêu cầu xuất báo cáo.

### Giải Pháp: AI Nội Bộ — Mạnh Như ChatGPT, An Toàn Như Hệ Thống Nội Bộ

GDIS AI Agent được xây dựng để **tận dụng sức mạnh của AI hiện đại trong một môi trường hoàn toàn kiểm soát được**:

| Tiêu Chí               | ChatGPT / Gemini (dịch vụ ngoài)      | GDIS AI Agent (nội bộ)               |
| ---------------------- | ------------------------------------- | ------------------------------------ |
| **Dữ liệu đi đâu?**    | Lên server của OpenAI / Google        | Ở lại trong hạ tầng GDIS             |
| **AI model dùng gì?**  | Model dùng chung với hàng triệu người | Model Azure riêng của GDIS           |
| **Kiểm soát truy cập** | Không có — ai cũng dùng được          | Đăng nhập tài khoản nội bộ + SSO     |
| **Tuân thủ bảo mật**   | Không đảm bảo                         | Đáp ứng chính sách bảo mật nội bộ    |
| **Hiểu dữ liệu GDIS**  | Không (model chung chung)             | Có — tùy biến riêng cho QC, sản xuất |

### Ba Lý Do Cốt Lõi

**1. Dữ liệu không rời khỏi GDIS**
Toàn bộ dữ liệu sản xuất, QC, kinh doanh được xử lý **100% trên server nội bộ GDIS**. AI chỉ nhận mô tả và cấu trúc dữ liệu để sinh code xử lý — không bao giờ đẩy dữ liệu thô ra ngoài internet.

**2. AI model thuộc sở hữu riêng của GDIS**
Hệ thống sử dụng mô hình AI (gpt-4o) được triển khai **riêng trên hạ tầng Azure của GDIS**, không phải dịch vụ ChatGPT chia sẻ công cộng. GDIS kiểm soát hoàn toàn ai được dùng, dùng bao nhiêu, và dữ liệu xử lý như thế nào.

**3. Tùy biến đặc thù cho GDIS**
Công cụ được tùy biến sâu cho nghiệp vụ GDIS: nhận diện dữ liệu QC, kết nối trực tiếp ClickHouse, hiểu các chỉ số kiểm soát chất lượng — điều mà ChatGPT hay Gemini không thể làm được.

---

## 1. Các Chức Năng Chính

### 1.1 Nhập & Kết Nối Dữ Liệu Đa Nguồn

Hệ thống hỗ trợ **tất cả nguồn dữ liệu phổ biến** mà GDIS đang sử dụng, người dùng không cần chuyển đổi hay nhờ IT xuất dữ liệu:

#### Nhóm 1 — File & Nhập Tay

| Nguồn                       | Mô Tả                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| **File CSV / Excel / JSON** | Kéo thả file lên giao diện, hệ thống tự nhận diện cấu trúc                                |
| **Chụp ảnh bảng số liệu**   | AI tự đọc và trích xuất bảng từ ảnh chụp màn hình hoặc ảnh thực tế (không cần nhập tay)   |
| **Dán văn bản lộn xộn**     | Copy-paste bất kỳ đoạn text không cấu trúc nào, AI tự phân tích thành bảng có cột rõ ràng |
| **Nhập thủ công**           | Tạo bảng nhanh trực tiếp trong ứng dụng                                                   |

#### Nhóm 2 — Cơ Sở Dữ Liệu Nội Bộ

| Hệ Thống               | Ghi Chú                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| **MySQL**              | Cơ sở dữ liệu quan hệ phổ biến                                              |
| **SQL Server (MSSQL)** | Hệ thống ERP, MES nội bộ GDIS                                               |
| **PostgreSQL**         | Cơ sở dữ liệu quan hệ mã nguồn mở                                           |
| **ClickHouse**         | Cơ sở dữ liệu phân tích tốc độ cao — **dùng cho dữ liệu QC thời gian thực** |

#### Nhóm 3 — Lưu Trữ Đám Mây

| Hệ Thống                        | Ghi Chú                                              |
| ------------------------------- | ---------------------------------------------------- |
| **Amazon S3**                   | Kho lưu trữ file lớn trên cloud (CSV, JSON, Parquet) |
| **Azure Blob Storage**          | Lưu trữ file trên Microsoft Azure                    |
| **Azure Data Explorer (Kusto)** | Nền tảng phân tích dữ liệu lớn của Microsoft         |

> **Lợi ích:** Không còn tình trạng nhân viên phải chờ IT xuất dữ liệu thủ công. Mọi nguồn dữ liệu GDIS đang có đều kết nối được trong **một công cụ duy nhất** — dù là file Excel đơn giản, hệ thống ERP hay kho lưu trữ đám mây.

---

### 1.2 Tạo Biểu Đồ Bằng Ngôn Ngữ Tự Nhiên

Người dùng **chỉ cần mô tả bằng tiếng Việt hoặc tiếng Anh**, AI sẽ tự động tạo biểu đồ phù hợp.

**Ví dụ câu lệnh người dùng có thể dùng:**

- _"Vẽ biểu đồ doanh thu theo từng tháng trong năm 2025"_
- _"So sánh tỷ lệ lỗi giữa các dây chuyền sản xuất"_
- _"Hiển thị top 10 sản phẩm có doanh số cao nhất"_
- _"Phân bố sản lượng theo ca làm việc"_

Hỗ trợ **hơn 30 loại biểu đồ** bao gồm: cột, đường, tròn, scatter, heatmap, bar chart ngang, biểu đồ kiểm soát chất lượng (SPC), v.v.

> **Lợi ích:** Nhân viên không cần biết Excel nâng cao hay Tableau. Ai cũng có thể tạo biểu đồ chuyên nghiệp trong vài giây.

---

### 1.3 Gợi Ý Phân Tích Thông Minh

Khi người dùng tải dữ liệu lên, AI **tự động đề xuất 4 hướng phân tích phù hợp** dựa trên bản chất dữ liệu. Với dữ liệu kiểm soát chất lượng (QC), AI nhận diện và ưu tiên các phân tích chuyên biệt như biểu đồ kiểm soát, phân tích sai lệch, xu hướng lỗi.

> **Lợi ích:** Người dùng không biết bắt đầu từ đâu vẫn có ngay gợi ý phân tích. Giảm thời gian "ngồi nhìn dữ liệu không biết làm gì".

---

### 1.4 Biến Đổi & Làm Sạch Dữ Liệu

AI có thể thực hiện các tác vụ xử lý dữ liệu theo yêu cầu:

- **Lọc, nhóm, tổng hợp:** Tính tổng, trung bình, đếm theo nhóm
- **Tạo cột mới:** "Thêm cột tỷ lệ lỗi = lỗi / tổng sản phẩm"
- **Làm sạch dữ liệu:** Xử lý dữ liệu thiếu, loại bỏ trùng lặp, chuẩn hóa định dạng
- **Ghép dữ liệu:** Kết hợp nhiều bảng dữ liệu với nhau theo điều kiện

> **Lợi ích:** Thay thế nhiều bước xử lý thủ công trên Excel. Giảm sai sót do thao tác tay.

---

### 1.5 Giám Sát Chất Lượng Sản Xuất (QC) — Thời Gian Thực

Đây là tính năng **được GDIS tùy biến riêng**, không có trong phiên bản gốc của Microsoft. Hệ thống kết nối trực tiếp vào cơ sở dữ liệu QC (ClickHouse) — nơi lưu kết quả đo kiểm từ dây chuyền sản xuất.

**Luồng hoạt động thực tế:**

```
Máy đo trên dây chuyền → Cơ sở dữ liệu QC (ClickHouse)
                                    ↓
              GDIS AI Agent kết nối, đọc dữ liệu mới nhất
                                    ↓
              Tự động nhận diện là dữ liệu chất lượng
                                    ↓
              Hiển thị biểu đồ kiểm soát + gợi ý phân tích QC
```

**Hệ thống tự động nhận diện** khi dữ liệu có các chỉ số kiểm soát (giá trị mục tiêu, giới hạn trên/dưới, cảnh báo nghiêm trọng, ca sản xuất...) và kích hoạt chế độ phân tích QC chuyên biệt.

**Ba loại biểu đồ kiểm soát chuyên biệt:**

| Loại Biểu Đồ                       | Công Dụng                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **QC Trend Line** (Đường xu hướng) | Theo dõi giá trị đo theo thời gian hoặc theo ca, kèm đường giới hạn kiểm soát — phát hiện ngay khi vượt ngưỡng |
| **QC Histogram** (Phân phối)       | Xem phân bố tổng thể của các giá trị đo — đánh giá độ ổn định của quy trình                                    |
| **QC Trend Bar** (Cột xu hướng)    | Phân tích xu hướng dạng cột cho dữ liệu phân loại (lỗi theo loại, theo dây chuyền...)                          |

**Khả năng xử lý:** Lên đến **1 triệu bản ghi** từ ClickHouse mà không ảnh hưởng hiệu năng.

> **Lợi ích:** Kỹ sư QC có thể tra cứu và phân tích dữ liệu kiểm soát **ngay lập tức** mà không cần chờ phòng IT xuất báo cáo. Bất thường sản xuất được phát hiện trong vài phút thay vì vài ngày.

---

### 1.6 Tạo Báo Cáo & Xuất File

Sau khi phân tích, người dùng có thể:

- **Xuất báo cáo PowerPoint (.pptx):** Biểu đồ và nội dung tự động được sắp xếp vào slide chuyên nghiệp
- **Tổng hợp nhiều biểu đồ thành dashboard:** Nhìn toàn cảnh trong một màn hình
- **Lưu lịch sử phân tích:** Mọi bước phân tích được lưu lại, có thể xem lại và tái sử dụng

> **Lợi ích:** Cắt giảm thời gian làm báo cáo định kỳ. Báo cáo nhất quán về hình thức và dễ chia sẻ.

---

### 1.7 Trợ Lý Chatbot Phân Tích

Người dùng có thể **hỏi trực tiếp bằng câu hỏi** về dữ liệu đang xem:

- _"Tháng nào có doanh thu cao nhất?"_
- _"Dây chuyền nào có tỷ lệ lỗi vượt ngưỡng trong quý này?"_
- _"Nguyên nhân chính gây ra sụt giảm sản lượng tuần trước là gì?"_

AI trả lời dựa trên dữ liệu thực tế, không đoán mò.

> **Lợi ích:** Như có một nhà phân tích dữ liệu cá nhân sẵn sàng trả lời mọi câu hỏi 24/7.

---

## 2. Lợi Ích Tổng Thể

### 2.1 Tiết Kiệm Thời Gian

| Tác Vụ                           | Trước Đây                       | Với GDIS AI Agent |
| -------------------------------- | ------------------------------- | ----------------- |
| Tạo một biểu đồ từ dữ liệu       | 30–60 phút (Excel + format)     | **< 1 phút**      |
| Làm báo cáo định kỳ hàng tuần    | Nửa ngày                        | **15–20 phút**    |
| Phân tích bất thường QC          | 1–2 ngày (yêu cầu IT)           | **Ngay lập tức**  |
| Ghép và xử lý nhiều bảng dữ liệu | Vài giờ (Excel hoặc yêu cầu IT) | **Vài phút**      |

### 2.2 Giảm Phụ Thuộc Vào Phòng IT

Người dùng nghiệp vụ **tự chủ động phân tích dữ liệu** mà không cần gửi yêu cầu và chờ đợi. Phòng IT được giải phóng khỏi các yêu cầu xuất báo cáo định kỳ.

### 2.3 Nâng Cao Chất Lượng Quyết Định

- Quyết định dựa trên **dữ liệu thực tế** thay vì cảm tính
- Phát hiện xu hướng và bất thường **sớm hơn**
- Mọi kết luận đều có biểu đồ và số liệu minh chứng rõ ràng

### 2.4 Dễ Sử Dụng, Không Cần Đào Tạo Chuyên Sâu

- Giao diện trực quan, thao tác kéo thả
- Không yêu cầu kỹ năng lập trình hay SQL
- Nhân viên mới có thể làm quen trong vài giờ

### 2.5 An Toàn & Bảo Mật

- Dữ liệu được xử lý **trong hệ thống nội bộ GDIS**, không gửi ra bên ngoài trừ khi cần gọi AI
- Có hệ thống đăng nhập xác thực (tài khoản nội bộ + Microsoft SSO)
- AI model sử dụng hạ tầng Azure được triển khai riêng của GDIS
- Có cơ chế giới hạn tần suất sử dụng để đảm bảo tài nguyên hệ thống

---

## 3. Đối Tượng Hưởng Lợi

| Bộ Phận                             | Lợi Ích Trực Tiếp                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| **Phòng QC / Kiểm soát chất lượng** | Phân tích dữ liệu sản xuất, phát hiện bất thường nhanh, tạo báo cáo kiểm soát tự động |
| **Phòng Kinh Doanh / Sales**        | Theo dõi doanh thu, phân tích xu hướng thị trường, báo cáo hiệu suất                  |
| **Ban Quản Lý / Lãnh Đạo**          | Nhìn toàn cảnh hoạt động qua dashboard, báo cáo kịp thời, quyết định nhanh hơn        |
| **Phòng Sản Xuất**                  | Theo dõi sản lượng, phân tích hiệu suất dây chuyền, tối ưu vận hành                   |
| **Phòng IT**                        | Giảm tải yêu cầu xuất báo cáo từ các phòng ban khác                                   |

---

## 4. Hiện Trạng Triển Khai

- **Trạng thái:** Đang vận hành nội bộ
- **Hạ tầng:** Server nội bộ GDIS + Azure AI (gpt-4o)
- **Truy cập:** Qua trình duyệt web — không cần cài đặt phần mềm
- **Người dùng mục tiêu:** Toàn bộ nhân viên GDIS có nhu cầu phân tích dữ liệu

---

_Tài liệu này được soạn thảo cho mục đích báo cáo nội bộ. Để biết thêm thông tin kỹ thuật chi tiết, vui lòng tham khảo tài liệu `TONG_QUAN_DU_AN.md`._
