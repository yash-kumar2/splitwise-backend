const express = require('express')
const User = require('../models/user')
const Group = require('../models/group')
const Expense = require('../models/expense')
const auth = require('../middleware/auth')
const router = new express.Router()

// POST: Create a new expense
const validateExpense = async (req, res, next) => {
    try {
      const { group, payers, splits } = req.body;
      const currentUserId = req.user._id;
       // Calculate total paid and total split
    const totalPaid = payers.reduce((sum, payer) => sum + payer.amount, 0);
    const totalSplit = splits.reduce((sum, split) => sum + split.amount, 0);

    // Check if total paid matches total split
    if (Math.abs(totalPaid - totalSplit) > 0.01) { // Allow small floating-point discrepancies
      return res.status(400).json({ 
        error: 'Total amount paid must exactly equal total amount split',
        totalPaid,
        totalSplit
      });
    }
  
      // Validate that current user is one of the payers or split recipients
      
      // If group is present, perform group-specific validations
      if (group) {
        // Find the group and check if current user is a member
        const groupDoc = await Group.findById(group);
        
        if (!groupDoc) {
          return res.status(404).json({ error: 'Group not found' });
        }
  
        // Check if current user is in the group
        const isUserInGroup = groupDoc.users.some(
          userId => userId.toString() === currentUserId.toString()
        );
        
        if (!isUserInGroup) {
          return res.status(403).json({ 
            error: 'User is not a member of this group' 
          });
        }
  
        // Validate that all payers and splits are from the group
        const groupUserIds = groupDoc.users.map(id => id.toString());
        
        const arePayersInGroup = payers.every(
          payer => groupUserIds.includes(payer.user.toString())
        );
        
        const areSplitsInGroup = splits.every(
          split => groupUserIds.includes(split.user.toString())
        );
  
        if (!arePayersInGroup || !areSplitsInGroup) {
          return res.status(400).json({ 
            error: 'All payers and split recipients must be members of the group' 
          });
        }
      } else {
        // If no group, ensure only one payer and one split
        if (payers.length !== 1 || splits.length !== 1) {
          return res.status(400).json({ 
            error: 'Without a group, there must be exactly one payer and one split recipient' 
          });
        }
        const isUserInPayersOrSplits = 
        payers.some(payer => payer.user.toString() === currentUserId.toString()) ||
        splits.some(split => split.user.toString() === currentUserId.toString());
      
      if (!isUserInPayersOrSplits) {
        return res.status(400).json({ 
          error: 'Current user must be one of the payers or split recipients' 
        });
      }
  
      }
  
      // If all validations pass, proceed to the next middleware/route handler
      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  const validateExpenseDeletion = async (req, res, next) => {
    try {
      const { id: expenseId } = req.params;
      const currentUserId = req.user._id;
  
      // Fetch the expense to be deleted
      const expense = await Expense.findById(expenseId);
      if (!expense) {
        return res.status(404).json({ error: 'Expense not found' });
      }
  
      const { group, payers } = expense;
  
      // Validate if current user is either a payer or creator of the expense
      const isUserAuthorized =
        expense.createdBy.toString() === currentUserId.toString() ||
        payers.some(payer => payer.user.toString() === currentUserId.toString());
  
      if (!isUserAuthorized) {
        return res.status(403).json({ error: 'User not authorized to delete this expense' });
      }
  
      // If group is specified, ensure user is part of the group
      if (group) {
        const groupDoc = await Group.findById(group);
  
        if (!groupDoc) {
          return res.status(404).json({ error: 'Group not found' });
        }
  
        const isUserInGroup = groupDoc.users.some(
          userId => userId.toString() === currentUserId.toString()
        );
  
        if (!isUserInGroup) {
          return res.status(403).json({ error: 'User is not a member of the group' });
        }
      }
  
      // If validation passes, proceed to the next middleware
      req.expense = expense; // Pass the expense to the next middleware
      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
  
  router.delete('/expense/:id', auth, validateExpenseDeletion, async (req, res) => {
    try {
      const { id: expenseId } = req.params;
      await Expense.findByIdAndDelete(expenseId);
      res.status(200).json({ message: 'Expense deleted successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
router.post('/expense',auth,validateExpense, async (req, res) => {
  try {
    const expense = new Expense(req.body);
    expense.createdBy=req.user._id;
    await expense.save();
    res.status(201).json(expense);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET: Retrieve all expenses
router.get('/', async (req, res) => {
  try {
    const expenses = await Expense.find().populate('group payers.user splits.user createdBy');
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT: Update an expense by ID
router.put('/:id', async (req, res) => {
  try {
    const expense = await Expense.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json(expense);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH: Partially update an expense by ID
router.patch('/:id', async (req, res) => {
  try {
    const expense = await Expense.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json(expense);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
router.post('/expenses/:id/mark-as-read',auth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  try {
    const expense = await Expense.findByIdAndUpdate(
      id,
      { $addToSet: { readList: userId } }, // Add userId to readList if not already present
      { new: true }
    );

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    res.status(200).json(expense);
  } catch (err) {
    res.status(500).json({ message: 'Error marking expense as read', error: err.message });
  }
});
router.post('/simplified-payments/:id/mark-as-read',auth, async (req, res) => {
  const { id } = req.params;
  const  userId = req.user._id;

  try {
    const simplifiedPayment = await SimplifiedPayment.findByIdAndUpdate(
      id,
      { $addToSet: { readList: userId } }, // Add userId to readList if not already present
      { new: true }
    );

    if (!simplifiedPayment) {
      return res.status(404).json({ message: 'Simplified Payment not found' });
    }

    res.status(200).json(simplifiedPayment);
  } catch (err) {
    res.status(500).json({ message: 'Error marking simplified payment as read', error: err.message });
  }
});
router.post('/settlements/:id/mark-as-read',auth, async (req, res) => {
  const { id } = req.params;
  console.log(req.user)
  const  userId = req.user._id;
  

  try {
    const settlement = await Settlement.findByIdAndUpdate(
      id,
      { $addToSet: { readList: userId } }, // Add userId to readList if not already present
      { new: true }
    );

    if (!settlement) {
      return res.status(404).json({ message: 'Settlement not found' });
    }

    res.status(200).json(settlement);
  } catch (err) {
    res.status(500).json({ message: 'Error marking settlement as read', error: err.message });
  }
});
router.delete('/simplified-payment/:id', auth, async (req, res) => {
  try {
      const paymentId = req.params.id;

      // Find the simplified payment
      const payment = await SimplifiedPayment.findById(paymentId);
      if (!payment) {
          return res.status(404).json({ message: 'Simplified Payment not found' });
      }

      // Find the group and check if the user is a member
      const group = await Group.findById(payment.group);
      if (!group) {
          return res.status(404).json({ message: 'Group not found' });
      }

      if (!group.users.includes(req.user._id)) {
          return res.status(403).json({ message: 'You are not authorized to delete this settlement' });
      }

      // Delete the simplified payment
      await SimplifiedPayment.findByIdAndDelete(paymentId);

      res.json({ message: 'Simplified Payment deleted successfully' });
  } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
  }
});


module.exports = router;
