# Dependencies + source (shared by the dev server and the production build).
FROM node:18-alpine AS deps
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .

# Development: React dev server with hot reload (docker compose --profile dev up frontend-dev).
FROM deps AS dev
EXPOSE 3001
CMD ["npm", "start"]

# Production build (also used for type checks: docker build --target build).
FROM deps AS build
# The API is served from the same origin under /api (see nginx.conf).
ARG REACT_APP_API_URL=/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL
RUN npm run build

# One web server for the whole system: the app at /, the API proxied at /api.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
