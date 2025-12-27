docker build -f Dockerfile.backend -t df-backend .

docker build -f Dockerfile.frontend -t df-frontend --build-arg VITE_REDIRECT_URI="https://172.19.16.22:8001" --build-arg VITE_API_HOST="172.19.16.22" --build-arg VITE_API_PORT="8000" .

# save

docker save df-backend | ssh administrator@172.19.16.22 docker load
docker save df-frontend | ssh administrator@172.19.16.22 docker load
matMa@server2019

# tạo chứng chỉ local

Tạo cert trực tiếp:
mkcert -cert-file 172.19.16.22.pem -key-file 172.19.16.22-key.pem 172.19.16.22
Di chuyển và đặt quyền:
sudo mkdir -p /etc/ssl/mycerts
sudo mv 172.19.16.22.pem /etc/ssl/mycerts/
sudo mv 172.19.16.22-key.pem /etc/ssl/mycerts/
sudo chown root:root /etc/ssl/mycerts/172.19.16.22\*
sudo chmod 644 /etc/ssl/mycerts/172.19.16.22.pem
sudo chmod 600 /etc/ssl/mycerts/172.19.16.22-key.pem
Sau có cert: build & chạy container HTTPS (nếu scripts không có)
docker build -f Dockerfile.frontend -t df-frontend:local
--build-arg VITE_REDIRECT_URI="https://172.19.16.22:8001"
--build-arg VITE_API_HOST="172.19.16.22"
--build-arg VITE_API_PORT="8000" .
docker rm -f df-frontend || true
docker run -d --name df-frontend -p 8001:443
-v /etc/ssl/mycerts/172.19.16.22.pem:/etc/ssl/mycerts/172.19.16.22.pem:ro
-v /etc/ssl/mycerts/172.19.16.22-key.pem:/etc/ssl/mycerts/172.19.16.22-key.pem:ro
df-frontend:local

Kiểm tra
ls -la /etc/ssl/mycerts
mkcert -CAROOT
curl --cacert "$(mkcert -CAROOT)/rootCA.pem" -vk https://172.19.16.22:8001
