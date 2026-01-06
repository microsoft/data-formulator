1️⃣ Frontend (ChartRecBox.tsx)
User gõ: "vẽ qc trend line"
→ POST /api/agent/data-rec-agent
Body: { description: "vẽ qc trend line" }

2️⃣ Backend Route (agent_routes.py)
Nhận request
→ Gọi SQLDataRecAgent.run(description="vẽ qc trend line")

3️⃣ SQLDataRecAgent.run() [agent_sql_data_rec.py - line 456+]

# Lấy data summary từ database

table_name = "CSCL_OSA_DEFECT_3"
data_summary = get_sql_table_statistics_str(self.conn, table_name)

# Kết quả: ~8KB metadata + sample data

# Tạo user query

user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{user_goal_str}"

# **ĐÂY LÀ ĐIỂM THEN CHỐT** (line 524-527)

messages = [
{"role":"system", "content": self.system_prompt}, # ← 15KB!
{"role":"user","content": user_query} # ← 8KB
]

# Gửi tới LLM

response = self.client.get_completion(messages=messages)

4️⃣ LiteLLM → OpenAI/Azure GPT-4o
Nhận toàn bộ messages (~23KB)
