# StandWeyz Account & Cloud Sync Backend

This is a lightweight Node.js Express server connected to MongoDB, designed to handle account registrations, logins, and profile/inventory cloud backups for the StandWeyz1 project.

## How to Run Locally

### Prerequisites
1. **Node.js**: Make sure you have Node.js installed (v16+ recommended).
2. **MongoDB**: Install MongoDB locally, or use a free MongoDB Atlas URI.

### Steps
1. Open PowerShell or Command Prompt in this folder (`c:\StandWeyz1 project\Server`).
2. Install the required Node packages:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
   The server will start on port `5000` (http://localhost:5000) and attempt to connect to your local MongoDB database (`mongodb://localhost:27017/standweyz`).

---

## Deploying to the Cloud (100% Free)

You can easily host this server on **Render.com** (Web Service free tier) or **Fly.io** (free tier).

### 1. MongoDB Setup (MongoDB Atlas)
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and sign up for a free account.
2. Create a free shared cluster (M0).
3. Under Database Access, create a user with a password.
4. Under Network Access, whitelist `0.0.0.0/0` (all IPs, so your cloud host can connect).
5. Go to Database -> Connect -> Connect your application. Copy the connection string. It will look like:
   `mongodb+srv://<username>:<password>@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority`

### 2. Render.com Deployment
1. Upload this server folder (or your entire project Git repository) to GitHub.
2. Sign up on [Render.com](https://render.com) using your GitHub account.
3. Click **New** -> **Web Service**.
4. Connect your GitHub repository.
5. Set the following settings:
   - **Root Directory**: `Server` (if your server folder is inside the main repository)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
6. Click **Advanced** and add an Environment Variable:
   - Key: `MONGODB_URI`
   - Value: (Your MongoDB Atlas connection string copied in step 1)
7. Click **Create Web Service**. Render will build and deploy your server automatically! It will give you a public URL (e.g. `https://standweyz-server.onrender.com`).
8. Open `AuthManager.cs` in the Unity project and change `ServerUrl` to your Render URL.
