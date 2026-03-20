const MAX_VEGA_DATA_POINTS = 5000;

Với 100k data:
numBuckets = Math.max(1000, 5000 / 3)
= Math.max(1000, 1667)
= 16670 buckets

bucketSize = Math.ceil(100000 / 1667)
= Math.ceil(59.99)
= ~60 điểm/bucket

📊 Kết quả cuối cùng:
Mỗi bucket lấy:

- first point → 1
- midpoint → 1
- last point → 1
- peak (max) → 1 (nếu không phải boundary)
- valley (min) → 1 (nếu không phải boundary)
  ───────────────────────
  Tối đa mỗi bucket → 5 điểm
  Trung bình → ~4 điểm

Tổng data kết quả:

Tối thiểu (3 điểm/bucket): 1667 × 3 = ~5,000 điểm
Trung bình (4 điểm/bucket): 1667 × 4 = ~6,668 điểm
Tối đa (5 điểm/bucket): 1667 × 5 = ~8,335 điểm

VỚI 100k DATA → Kết quả: 5k - 8.3k điểm (50-83% nén)

Ý tưởng:

Nếu muốn output ~5000 điểm
Mỗi bucket lấy ~3 điểm (safest)
Cần chia thành 5000/3 ≈ 1667 buckets
Nhưng lấy tối đa 5 điểm → output có thể lên tới 8335 điểm\

📈 Ví dụ các dataset khác:

Input Data Num Buckets Points/Bucket Output (avg)
5k 1667 Tất cả 5k (không sample)
10k 1667 6 ~6.6k
50k 1667 30 ~6.6k
100k 1667 60 ~6.6k
500k 1667 300 ~6.6k
1M 1667 600 ~6.6k

→ Output ổn định ~6.6k-8.3k dù input có 10k hay 1M! 🚀

📝 Tóm tắt cho 100k data của bạn:

Hiện tại:

- Input: 100k data
- Output: 6,668 - 8,335 điểm (nén 8-10%)
- Nhanh hơn: 100k / 6.6k = ~15x lần
- Render time: 30s → ~2s ✅
