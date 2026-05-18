# Структура файлов проекта

## Дерево проекта

```
nginx/
├── default.conf
└── Dockerfile
```

---

## Директория: `nginx`

Найдено 2 файл(ов):

### Файл: `Dockerfile`

```
FROM nginx:1.27-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY frontend /usr/share/nginx/html
COPY covers /opt/playnext/covers

RUN chmod -R a+rX /usr/share/nginx/html /opt/playnext/covers

```

---

### Файл: `default.conf`

```
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://backend:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /covers/ {
        alias /opt/playnext/covers/;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}

```

---

