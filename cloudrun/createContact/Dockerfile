FROM node:18-slim
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
CMD ["node_modules/.bin/functions-framework", "--target=createContact", "--port=8080"]
