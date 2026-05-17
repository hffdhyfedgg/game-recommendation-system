FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage - serve with nginx
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY covers /opt/playnext/covers 2>/dev/null || true

RUN chmod -R a+rX /usr/share/nginx/html /opt/playnext/covers 2>/dev/null || true

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
