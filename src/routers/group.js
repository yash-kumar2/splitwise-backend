const express = require('express')
const User = require('../models/user')
const Group = require('../models/group')
const auth = require('../middleware/auth')
const router = new express.Router()


// Middleware for user authentication (stub for demonstration)


// POST: Create a new group
router.post('/group',auth, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'Group name is required.' });

    const group = new Group({
      name,
      users: [req.user._id], 
    });

    await group.save();
    res.status(201).json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT: Update group details
router.put('/:id', async (req, res) => {
  try {
    const groupId = req.params.id;
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'Group name is required.' });

    const group = await Group.findByIdAndUpdate(
      groupId,
      { name },
      { new: true, runValidators: true }
    );

    if (!group) return res.status(404).json({ error: 'Group not found.' });

    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Add members to a group
router.post('group/:id/add-members', auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const { users } = req.body; // Expecting an array of user IDs

    if (!Array.isArray(users) || users.length === 0)
      return res.status(400).json({ error: 'At least one user ID is required.' });

    const group = await Group.findById(groupId);
    

    if (!group) return res.status(404).json({ error: 'Group not found.' });

    // Check if the requesting user is a member of the group
    if (!group.users.includes(req.user._id)) {
      return res.status(403).json({ error: 'You must be a member of the group to add new members.' });
    }

    // Add new members, avoiding duplicates
    const newUsers = users.filter(user => !group.users.includes(user));
    group.users.push(...newUsers);

    await group.save();
    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.post('/:id/simplify-payments',auth, async (req, res) => {
  try {
    const groupId = req.params.id;

    const expenses = await Expense.find({ group: groupId });
    const settlements = await Settlement.find({ group: groupId });
    const existingSimplifications = await SimplifiedPayment.find({ group: groupId });

    // Calculate balances from expenses, settlements, and existing simplifications
    const balances = {};

    const updateBalances = (from, to, amount) => {
      if (!balances[from]) balances[from] = {};
      if (!balances[to]) balances[to] = {};

      balances[from][to] = (balances[from][to] || 0) + amount;
      balances[to][from] = (balances[to][from] || 0) - amount;
    };

    // Process Expenses
    expenses.forEach(expense => {
      const totalSplit = expense.splits.reduce((sum, split) => sum + split.amount, 0);
      expense.payers.forEach(payer => {
        const contributionRatio = payer.amount / totalSplit;
        expense.splits.forEach(split => {
          updateBalances(payer.user.toString(), split.user.toString(), split.amount * contributionRatio);
        });
      });
    });

    // Process Settlements
    settlements.forEach(settlement => {
      settlement.settlements.forEach(detail => {
        updateBalances(settlement.settler.toString(), detail.user.toString(), detail.amount);
      });
    });

    // Process Existing Simplifications
    existingSimplifications.forEach(simplified => {
      updateBalances(simplified.payer.toString(), simplified.payee.toString(), simplified.amount);
    });

    // Simplify balances
    const transactions = [];
    const users = Object.keys(balances);

    while (users.length > 0) {
      const debtor = users.find(user => {
        return Object.values(balances[user] || {}).reduce((sum, value) => sum + value, 0) < 0;
      });

      const creditor = users.find(user => {
        return Object.values(balances[user] || {}).reduce((sum, value) => sum + value, 0) > 0;
      });

      if (!debtor || !creditor) break;

      const debt = Math.min(Math.abs(balances[debtor][creditor]), Math.abs(balances[creditor][debtor]));

      if (debt > 0) {
        transactions.push({ payer: debtor, payee: creditor, amount: debt });
        updateBalances(debtor, creditor, -debt);
      }
    }

    // Save Simplified Payments
    const simplifiedPayments = await SimplifiedPayment.insertMany(
      transactions.map(transaction => ({
        group: groupId,
        payer: transaction.payer,
        payee: transaction.payee,
        amount: transaction.amount,
      }))
    );

    res.json({ simplifiedPayments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update activities to include simplified transactions
router.get('/:id/activities',auth, async (req, res) => {
  try {
    const groupId = req.params.id;

    const expenses = await Expense.find({ group: groupId }).populate('payers.user splits.user createdBy');
    const settlements = await Settlement.find({ group: groupId }).populate('settler settlements.user');
    const simplifiedPayments = await SimplifiedPayment.find({ group: groupId }).populate('payer payee');

    const activities = {
      expenses,
      settlements,
      simplifiedPayments,
    };

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Calculate balances (including simplified payments)
router.get('/:id/balances',auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const userId = req.user._id;

    const expenses = await Expense.find({ group: groupId });
    const settlements = await Settlement.find({ group: groupId });
    const simplifiedPayments = await SimplifiedPayment.find({ group: groupId });

    const balances = {};

    const updateBalances = (from, to, amount) => {
      if (!balances[from]) balances[from] = 0;
      if (!balances[to]) balances[to] = 0;

      balances[from] -= amount;
      balances[to] += amount;
    };

    // Process all transactions
    expenses.forEach(expense => {
      const totalSplit = expense.splits.reduce((sum, split) => sum + split.amount, 0);
      expense.payers.forEach(payer => {
        const contributionRatio = payer.amount / totalSplit;
        expense.splits.forEach(split => {
          updateBalances(payer.user.toString(), split.user.toString(), split.amount * contributionRatio);
        });
      });
    });

    settlements.forEach(settlement => {
      settlement.settlements.forEach(detail => {
        updateBalances(settlement.settler.toString(), detail.user.toString(), detail.amount);
      });
    });

    simplifiedPayments.forEach(payment => {
      updateBalances(payment.payer.toString(), payment.payee.toString(), payment.amount);
    });

    res.json(balances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;