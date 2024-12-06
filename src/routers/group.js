const express = require('express')
const User = require('../models/user')
const Group = require('../models/group')
const Expense = require('../models/expense')
const Settlement=require('../models/settlement')
const SimplifiedPayment=require('../models/simplifiedPayment')
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
router.post('/group/:id/add-members', auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const { users } = req.body; 
    const uniqueUsers = Array.from(new Set(users.map(user => user.id)))
    .map(id => users.find(user => user.id === id));// Expecting an array of user IDs

    if (!Array.isArray(users) || users.length === 0)
      return res.status(400).json({ error: 'At least one user ID is required.' });

    const group = await Group.findById(groupId);
    

    if (!group) return res.status(404).json({ error: 'Group not found.' });

    // Check if the requesting user is a member of the group
    if (!group.users.includes(req.user._id)) {
      return res.status(403).json({ error: 'You must be a member of the group to add new members.' });
    }

    // Add new members, avoiding duplicates
    const newUsers = uniqueUsers.filter(user => !group.users.includes(user));
    group.users.push(...newUsers);


    await group.save();
    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.post('/group/:id/simplify-payments', auth, async (req, res) => {
  try {
    const groupId = req.params.id;

    const expenses = await Expense.find({ group: groupId });
    const settlements = await Settlement.find({ group: groupId });
    const existingSimplifications = await SimplifiedPayment.find({ group: groupId });

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
      simplified.payments.forEach(payment => {
        updateBalances(payment.payer.toString(), payment.payee.toString(), payment.amount);
      });
    });
            const allUsers = new Set();
        expenses.forEach(expense => {
          expense.payers.forEach(payer => allUsers.add(payer.user.toString()));
          expense.splits.forEach(split => allUsers.add(split.user.toString()));
        });
        settlements.forEach(settlement => {
          allUsers.add(settlement.settler.toString());
          settlement.settlements.forEach(detail => allUsers.add(detail.user.toString()));
        });
        existingSimplifications.forEach(simplified => {
          simplified.payments.forEach(payment => {
            allUsers.add(payment.payer.toString());
            allUsers.add(payment.payee.toString());
          });
        });

        // Initialize balances for all users
        allUsers.forEach(user => {
          allUsers.forEach(user2=>{
            if(!balances[user][user2])balances[user][user2]=0
          })
        });

    console.log("Initial Balances:", balances);

    const simplifyBalances = (balances) => {
      const simplifiedPayments = [];
    
      // Helper function to find a cycle using DFS
      const findCycle = (current, visited, stack, path) => {
        visited.add(current);
        path.push(current);
    
        for (const neighbor in balances[current]) {
          if (balances[current][neighbor] > 0) {
            if (stack.has(neighbor)) {
              // Cycle found, extract the cycle
              const cycleStartIndex = path.indexOf(neighbor);
              return path.slice(cycleStartIndex).map((node, index) => ({
                from: path[(cycleStartIndex + index) % path.length],
                to: path[(cycleStartIndex + index + 1) % path.length],
                amount: balances[path[(cycleStartIndex + index) % path.length]][
                  path[(cycleStartIndex + index + 1) % path.length]
                ],
              }));
            }
    
            if (!visited.has(neighbor)) {
              stack.add(neighbor);
              const cycle = findCycle(neighbor, visited, stack, path);
              if (cycle) return cycle;
              stack.delete(neighbor);
            }
          }
        }
    
        path.pop();
        return null;
      };
    
      // Main loop to simplify balances
      while (true) {
        const visited = new Set();
        let cycleFound = false;
    
        for (const user in balances) {
          if (!visited.has(user)) {
            const stack = new Set([user]);
            const path = [];
            const cycle = findCycle(user, visited, stack, path);
    
            if (cycle) {
              cycleFound = true;
    
              // Find the minimum edge in the cycle
              const minEdge = Math.min(...cycle.map(({ amount }) => amount));
    
              // Reduce the cycle by the minimum edge and update balances
              cycle.forEach(({ from, to }) => {
                balances[from][to] -= minEdge;
                balances[to] = balances[to] || {};
                balances[to][from] = (balances[to][from] || 0) + minEdge;
    
                if (balances[from][to] === 0) delete balances[from][to];
                if (balances[to][from] === 0) delete balances[to][from];
    
                // Record the simplified payment
                simplifiedPayments.push({ payee: from, payer: to, amount: minEdge });
              });
    
              break;
            }
          }
        }
    
        if (!cycleFound) break; // Exit when no cycles are left
      }
    
      return simplifiedPayments;
    };
    

    const simplifiedPayments = simplifyBalances(balances);

    const simplifiedPayment = new SimplifiedPayment({
      group: groupId,
      payments: simplifiedPayments,
    });

    await simplifiedPayment.save();

    res.json({ simplifiedPayment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// router.post('/group/:id/simplify-payments',auth, async (req, res) => {
//   try {
//     const groupId = req.params.id;

//     const expenses = await Expense.find({ group: groupId });
//     const settlements = await Settlement.find({ group: groupId });
//     const existingSimplifications = await SimplifiedPayment.find({ group: groupId });

//     // Calculate balances from expenses, settlements, and existing simplifications
//     const balances = {};

//     const updateBalances = (from, to, amount) => {
//       if (!balances[from]) balances[from] = {};
//       if (!balances[to]) balances[to] = {};

//       balances[from][to] = (balances[from][to] || 0) + amount;
//       balances[to][from] = (balances[to][from] || 0) - amount;
//     };

//     // Process Expenses
//     expenses.forEach(expense => {
//       const totalSplit = expense.splits.reduce((sum, split) => sum + split.amount, 0);
//       expense.payers.forEach(payer => {
//         const contributionRatio = payer.amount / totalSplit;
//         expense.splits.forEach(split => {
//           updateBalances(payer.user.toString(), split.user.toString(), split.amount * contributionRatio);
//         });
//       });
//     });

//     // Process Settlements
//     settlements.forEach(settlement => {
//       settlement.settlements.forEach(detail => {
//         updateBalances(settlement.settler.toString(), detail.user.toString(), detail.amount);
//       });
//     });

//     // Process Existing Simplifications
//     existingSimplifications.forEach(simplified => {
//       simplified.payments.forEach(payment => {
//         updateBalances(payment.payer.toString(), payment.payee.toString(), payment.amount);
//       });
//     });
//      console.log(balances)
//     // Simplify balances
//     const transactions = [];
//     const users = Object.keys(balances);

//     while (users.length > 0) {
//       const debtor = users.find(user => {
//         return Object.values(balances[user] || {}).reduce((sum, value) => sum + value, 0) < 0;
//       });

//       const creditor = users.find(user => {
//         return Object.values(balances[user] || {}).reduce((sum, value) => sum + value, 0) > 0;
//       });

//       if (!debtor || !creditor) break;

//       const debt = Math.min(Math.abs(balances[debtor][creditor]), Math.abs(balances[creditor][debtor]));

//       if (debt > 0) {
//         transactions.push({ payer: debtor, payee: creditor, amount: debt });
//         updateBalances(debtor, creditor, -debt);
//       }
//     }

//     // Save Simplified Payments
//     const simplifiedPayment = new SimplifiedPayment({
//       group: groupId,
//       payments: transactions.map(transaction => ({
//         payer: transaction.payer,
//         payee: transaction.payee,
//         amount: transaction.amount,
//       }))
//     });

//     await simplifiedPayment.save();

//     res.json({ simplifiedPayment });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
// Update activities to include simplified transactions
router.get('/group/:id/activities',auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const group = await Group.findById(groupId);
    if (!group.users.includes(req.user._id)) {
      return res.status(403).json({ error: 'You must be a member of the group to get activities.' });
    }
    console.log(Expense,SimplifiedPayment)


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

// Update activities to include simplified transactions
router.get('/group/:id/activities',auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const group = await Group.findById(groupId);
    if (!group.users.includes(req.user._id)) {
      return res.status(403).json({ error: 'You must be a member of the group to get activities.' });
    }

    const expenses = await Expense.find({ group: groupId }).populate('payers.user splits.user createdBy');
    const settlements = await Settlement.find({ group: groupId }).populate('settler settlements.user');
    const simplifiedPayments = await SimplifiedPayment.find({ group: groupId }).populate('payments.payer payments.payee');

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
router.get('/groups', auth, async (req, res) => {
  try {
    console.log(req.user._id)
    const userId = req.user._id;

     
    const groups = await Group.find({ users: userId });

    const balances = {}; 

    const updateBalances = (groupId, from, to, amount) => {
      if (!balances[groupId]) balances[groupId] = {};
      if (!balances[groupId][from]) balances[groupId][from] = 0;
      if (!balances[groupId][to]) balances[groupId][to] = 0;

      if (from === userId.toString() || to === userId.toString()) {
        balances[groupId][from] -= amount;
        balances[groupId][to] += amount;
      }
    };
    //console.log(groups)

    for (const group of groups) {
      
      const groupId = group._id.toString();
      balances[groupId]={}

      const expenses = await Expense.find({ group: groupId });
      const settlements = await Settlement.find({ group: groupId });
      const simplifiedPayments = await SimplifiedPayment.find({ group: groupId });

      // Process expenses
      expenses.forEach((expense) => {
        const totalSplit = expense.splits.reduce((sum, split) => sum + split.amount, 0);
        expense.payers.forEach((payer) => {
          const contributionRatio = payer.amount / totalSplit;
          expense.splits.forEach((split) => {
            updateBalances(groupId, payer.user.toString(), split.user.toString(), split.amount * contributionRatio);
          });
        });
      });

      // Process settlements
      settlements.forEach((settlement) => {
        settlement.settlements.forEach((detail) => {
          updateBalances(groupId, settlement.settler.toString(), detail.user.toString(), detail.amount);
        });
      });

      // Process simplified payments
      simplifiedPayments.forEach((simplifiedPayment) => {
        simplifiedPayment.payments.forEach((payment) => {
          updateBalances(groupId, payment.payer.toString(), payment.payee.toString(), payment.amount);
        });
      });
    }
    console.log(balances)

    // Calculate net balances
    const groupBalances = Object.keys(balances).map((groupId) => {
      const netBalance = Object.values(balances[groupId]).reduce((sum, val) => sum + val, 0);
      return {
        groupId,
        groupName: groups.find((group) => group._id.toString() === groupId).name,
        netBalance,
      };
    });
    //console.log(groupBalances)

    res.json(groupBalances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Calculate balances (including simplified payments)
router.get('/group/:id/balances',auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const userId = req.user._id;

    const expenses = await Expense.find({ group: groupId });
    const settlements = await Settlement.find({ group: groupId });
    const simplifiedPayments = await SimplifiedPayment.find({ group: groupId });

    const balances = {};

    const updateBalances = (from, to, amount) => {
      if(from==to){
        return
      }
      if(from!=req.user._id.toString()&&to!=req.user._id.toString()){
        return;
      }
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

    simplifiedPayments.forEach(simplifiedPayment => {
      simplifiedPayment.payments.forEach(payment => {
        updateBalances(payment.payer.toString(), payment.payee.toString(), payment.amount);
      });
    });

    res.json(balances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;