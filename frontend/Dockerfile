# Dependencies + source (shared by the dev server and the production build).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Exact versions from the lockfile: a build never picks up a newer, unreviewed dependency.
RUN npm ci
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
# No source maps in production, and no inline script, so the Content-Security-Policy can forbid inline scripts.
ENV GENERATE_SOURCEMAP=false INLINE_RUNTIME_CHUNK=false
RUN npm run build

# One web server for the whole system: the app at /, the API proxied at /api.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
