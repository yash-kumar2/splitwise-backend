const express = require('express')
const User = require('../models/user')
const Group = require('../models/group')
const Expense = require('../models/expense')
const Settlement=require('../models/settlement')
const SimplifiedPayment=require('../models/simplifiedPayment')
const auth = require('../middleware/auth')
const router = new express.Router()

router.get('/friend-balances', auth, async (req, res) => {
    try {
      
      const userId = req.user._id;
  
      // Fetch groups that the user is part of
      const groups = await Group.find({ users: userId });
      const groupIds = groups.map(group => group._id);
  
      // Fetch the user's friends
      const user = await User.findById(userId).populate('friends', 'userId email');
      const friends = user.friends;
  
      // Fetch all expenses, settlements, and simplified payments for the user's groups
      const [expenses, settlements, simplifiedPayments] = await Promise.all([
        Expense.find({ group: { $in: groupIds } })
          .populate('payers.user', 'userId email')
          .populate('splits.user', 'userId email'),
        Settlement.find({ group: { $in: groupIds } })
          .populate('settler', 'userId email')
          .populate('settlements.user', 'userId email'),
        SimplifiedPayment.find({ group: { $in: groupIds } })
          .populate('payments.payer', 'userId email')
          .populate('payments.payee', 'userId email'),
      ]);
  
      const balances = {};
  
      const initializeBalance = (user) => {
        if (!user) return;
        const userId = user._id ? user._id.toString() : user;
        if (!balances[userId]) {
          balances[userId] = { balance: 0, user: user };
        }
      };
  
      const updateBalances = (from, to, amount) => {
        if (!from || !to || from === to || (from._id.toString() !== userId.toString() && to._id.toString() !== userId.toString())) return;
        initializeBalance(from);
        initializeBalance(to);
  
        const fromId = from._id ? from._id.toString() : from;
        const toId = to._id ? to._id.toString() : to;
  
        balances[fromId].balance -= amount;
        balances[toId].balance += amount;
      };
  
      // Calculate balances from expenses
      expenses.forEach((expense) => {
        const totalSplit = expense.splits.reduce((sum, split) => sum + (split.amount || 0), 0);
        expense.payers.forEach((payer) => {
          if (!payer.user || !payer.amount) return;
  
          const contributionRatio = payer.amount / totalSplit;
          expense.splits.forEach((split) => {
            if (!split.user) return;
  
            const splitAmount = split.amount * contributionRatio;
            updateBalances(payer.user, split.user, splitAmount);
          });
        });
      });
  
      // Calculate balances from settlements
      settlements.forEach((settlement) => {
        if (!settlement.settler) return;
  
        settlement.settlements.forEach((detail) => {
          if (!detail.user) return;
  
          updateBalances(settlement.settler, detail.user, detail.amount);
        });
      });
  
      // Calculate balances from simplified payments
      simplifiedPayments.forEach((simplifiedPayment) => {
        simplifiedPayment.payments.forEach((payment) => {
          if (!payment.payer || !payment.payee) return;
  
          updateBalances(payment.payer, payment.payee, payment.amount);
        });
      });
  
      // Filter balances for friends only and calculate the sum
      const friendBalances = friends.map((friend) => {
        const friendId = friend._id.toString();
        const balance = balances[friendId] ? Number(balances[friendId].balance.toFixed(2)) : 0;
        return { friendId, friend, balance };
      });
  
      const totalBalance = friendBalances.reduce((sum, { balance }) => sum + balance, 0);
  
      res.json({ userId, friendBalances, totalBalance });
    } catch (err) {
      console.error('Friend balance calculation error:', err);
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  });
  
  






module.exports = router;