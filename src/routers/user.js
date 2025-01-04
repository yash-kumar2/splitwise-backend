const express = require('express')
const User = require('../models/user')
const Group = require('../models/group')
const Expense = require('../models/expense')
const Settlement=require('../models/settlement')
const SimplifiedPayment=require('../models/simplifiedPayment')
const auth = require('../middleware/auth')
const router = new express.Router()

router.post('/users', async (req, res) => {
    const user = new User(req.body)

    try {
        await user.save()
        const token = await user.generateAuthToken()
        res.status(201).send({ user, token })
    } catch (e) {
        res.status(400).send(e)
    }
})
router.get('/users/search', async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.status(400).send({ error: 'Query parameter is required' });
    }

    try {
        const users = await User.find({ 
            userId: { $regex: query, $options: 'i' } // Case-insensitive search for userId
        }).select('_id userId email'); // Return only relevant fields
        res.send(users);
    } catch (error) {
        res.status(500).send({ error: 'Failed to fetch users' });
    }
});


router.post('/users/login', async (req, res) => {
    try {
        const user = await User.findByCredentials(req.body.email, req.body.password)
        const token = await user.generateAuthToken()
        res.send({ user, token })
    } catch (e) {
        res.status(400).send()
    }
})

router.post('/users/logout', auth, async (req, res) => {
    try {
        req.user.tokens = req.user.tokens.filter((token) => {
            return token.token !== req.token
        })
        await req.user.save()

        res.send()
    } catch (e) {
        res.status(500).send()
    }
})

router.post('/users/logoutAll', auth, async (req, res) => {
    try {
        req.user.tokens = []
        await req.user.save()
        res.send()
    } catch (e) {
        res.status(500).send()
    }
})

router.get('/users/me', auth, async (req, res) => {
    res.send(req.user)
})

router.patch('/users/me', auth, async (req, res) => {
    const updates = Object.keys(req.body)
    const allowedUpdates = ['name', 'email', 'password', 'phone']
    const isValidOperation = updates.every((update) => allowedUpdates.includes(update))

    if (!isValidOperation) {
        return res.status(400).send({ error: 'Invalid updates!' })
    }

    try {
        updates.forEach((update) => req.user[update] = req.body[update])
        await req.user.save()
        res.send(req.user)
    } catch (e) {
        res.status(400).send(e)
    }
})

router.delete('/users/me', auth, async (req, res) => {
    try {
        await req.user.remove()
        res.send(req.user)
    } catch (e) {
        res.status(500).send()
    }
})
router.get('/user/activity', auth, async (req, res) => {
    try {
      const userId = req.user._id; // Logged-in user
      const friendId = req.params.id; // Friend's ID
  
      // Fetch activities where both the user and the friend are involved
      const [expenses, settlements, simplifiedPayments] = await Promise.all([
        Expense.find({
          $or: [
            { 'payers.user': { $in: [userId] } },
            { 'splits.user': { $in: [userId] } },
          ],
        })
          .populate('payers.user', 'userId email')
          .populate('splits.user', 'userId email')
          .populate('group', 'name'), // Populate group name
        Settlement.find({
          $or: [
            { settler: { $in: [userId] } },
            { 'settlements.user': { $in: [userId] } },
          ],
        })
          .populate('settler', 'userId email')
          .populate('settlements.user', 'userId email')
          .populate('group', 'name'), // Populate group name
        SimplifiedPayment.find({
          $or: [
            { 'payments.payer': { $in: [userId] } },
            { 'payments.payee': { $in: [userId] } },
          ],
        })
          .populate('payments.payer', 'userId email')
          .populate('payments.payee', 'userId email')
          .populate('group', 'name'), // Populate group name
      ]);
  
      // Combine all activities into a single array
      const activities = [
        ...expenses.map((expense) => ({
          type: 'expense',
          data: expense,
        })),
        ...settlements.map((settlement) => ({
          type: 'settlement',
          data: settlement,
        })),
        ...simplifiedPayments.map((payment) => ({
          type: 'simplifiedPayment',
          data: payment,
        })),
      ];
  
      // Filter activities to ensure both the user and friend are involved
      
  
      res.json({ activities,user:userId });
    } catch (err) {
      console.error('Error fetching friend activities:', err);
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  });

module.exports = router