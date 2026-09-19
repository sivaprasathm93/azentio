FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_MODE=live
ARG VITE_API_USER=analyst
ENV VITE_API_MODE=$VITE_API_MODE VITE_API_USER=$VITE_API_USER
RUN npm run build

FROM nginx:1.27-alpine
# nginx's entrypoint runs envsubst on templates/*.template; BACKEND_BASIC_AUTH = base64(user:password)
COPY templates/ /etc/nginx/templates/
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
