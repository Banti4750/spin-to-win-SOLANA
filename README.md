<div align="center">

# 🎡 Spin to Win  
**A Decentralized Lottery Game on Solana**

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)  
Built with ❤️ on Solana, using React, Anchor, Rust & Express.

</div>

---

## 🧩 What is Spin to Win?

**Spin to Win** is a decentralized lottery-style dApp built on the **Solana blockchain**.  
Buy a ticket, spin the wheel, and win rewards — all in a fully transparent and trustless way.

---

## 🚀 Features

- 🎟️ **Buy Tickets** — Pay with SOL/SPL tokens to participate  
- 🎯 **Spin the Wheel** — Interactive frontend with animated spins  
- 💸 **Claim Rewards** — Receive rewards directly in your wallet  
- 🔐 **Fully On-Chain Logic** — No hidden server magic  
- 🌐 **Fast & Cheap** — Powered by Solana’s high-speed network

---

## 🛠️ Tech Stack

| Layer        | Technology                       |
|--------------|----------------------------------|
| **Frontend** | React · Vite · Tailwind CSS      |
| **Backend**  | Node.js · Express.js             |
| **Blockchain** | Solana · Anchor Framework · Rust |

---

## ⚙️ Getting Started

### 📦 Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org/) `v18+`
- [Yarn](https://yarnpkg.com/) or `npm`
- [Rust & Cargo](https://rustup.rs/)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation)

---

### 🔍 Clone the Repository

```bash
git clone https://github.com/your-username/spinToWin.git
cd spinToWin
```

---

### 📁 Install Dependencies

#### 🧠 Smart Contract

```bash
cd contract
yarn install
```

#### 💻 Client

```bash
cd ../client
npm install
# or yarn install
```

#### 🔧 Server

```bash
cd ../server
npm install
# or yarn install
```

---

### 🧪 Deploy to Local Validator or Devnet

```bash
solana config set --url localhost
# or for devnet
# solana config set --url https://api.devnet.solana.com

solana-test-validator
```

Deploy program:

```bash
cd contract
anchor build
anchor deploy
```

🔑 **Update Program ID**

Replace the ID in your frontend config:

```js
// client/src/utils/constants.js
export const PROGRAM_ID = "REPLACE_WITH_YOUR_PROGRAM_ID";
```

---

## 🧬 Running the App

### ▶️ Start the Backend

```bash
cd server
npm start
```

### 🖥️ Start the Frontend

```bash
cd client
npm run dev
```

➡️ Visit: [http://localhost:5173](http://localhost:5173)

---

## 🧪 Smart Contract Testing

```bash
cd contract
anchor test
```

---

## 🗂️ Project Structure

```
spinToWin/
├── contract/   # Anchor Smart Contract (Rust)
├── client/     # Frontend (React + Vite + Tailwind)
├── server/     # API Server (Express.js)
```

---

## 🤝 Contributing

We welcome contributions! 🚀

- Fork the repo
- Create a new branch
- Submit a pull request

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

## 📬 Questions or Feedback?

Open an [issue](https://github.com/your-username/spinToWin/issues) or start a discussion.