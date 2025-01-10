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
// router.post('/group/add-members', auth, async (req, res) => {
//   const { groupId, newMemberIds } = req.body; // `newMemberIds` is an array of user IDs

//   try {
//       // Fetch all current members of the group (replace with your group logic if needed)
//       const group = await Group.findById(groupId).populate('members'); // Assuming a `Group` model exists
//       if (!group) {
//           return res.status(404).send({ error: 'Group not found' });
//       }

//       const currentMembers = group.members; // Existing group members
//       const allMemberIds = [...currentMembers.map(member => member._id.toString()), ...newMemberIds];

//       // Ensure all members (previous and new) are friends with one another
//       const allMembers = await User.find({ _id: { $in: allMemberIds } });

//       for (let i = 0; i < allMembers.length; i++) {
//           const member = allMembers[i];

//           // Add all other members to the current member's friends list
//           for (let j = 0; j < allMembers.length; j++) {
//               if (i !== j && !member.friends.includes(allMembers[j]._id)) {
//                   member.friends.push(allMembers[j]._id);
//               }
//           }

//           // Save the updated member
//           await member.save();
//       }

//       // Add new members to the group (if needed)
//       group.members = allMemberIds;
//       await group.save();

//       res.status(200).send({ message: 'Members added and friendships updated successfully' });
//   } catch (e) {
//       console.error(e);
//       res.status(400).send(e);
//   }
// });

// POST: Add members to a group
router.post('/group/:id/add-members', auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const { users } = req.body;

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: 'At least one user ID is required.' });
    }

    const uniqueUsers = Array.from(new Set(users.map(user => user.id)))
      .map(id => users.find(user => user.id === id));

    const group = await Group.findById(groupId).populate('users');
    if (!group) return res.status(404).json({ error: 'Group not found.' });

    const currentMembers = group.users;

    // Check if the requesting user is a member of the group
    if (!currentMembers.some(member => member._id.toString() === req.user._id.toString())) {
      return res.status(403).json({ error: 'You must be a member of the group to add new members.' });
    }

    // Add new members, avoiding duplicates
    const newUsers = uniqueUsers.filter(user => 
      !currentMembers.some(member => member._id.toString() === user.id)
    );
    group.users.push(...newUsers);

    await group.save();

    const allMemberIds = [
      ...currentMembers.map(member => member._id.toString()),
      ...newUsers.map(user => user.id),
    ];
    const allMembers = await User.find({ _id: { $in: allMemberIds } });

    // Update friends lists in bulk
    const updates = allMembers.map(member => {
      const friends = allMembers
        .filter(other => other._id.toString() !== member._id.toString())
        .map(other => other._id);

      return User.updateOne(
        { _id: member._id },
        { $addToSet: { friends: { $each: friends } } }
      );
    });
    await Promise.all(updates);

    res.json({
      id: group._id,
      name: group.name,
      users: group.users.map(user => ({ id: user._id, name: user.name })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});
const isValidAmount = (amount) => typeof amount === 'number' && !isNaN(amount) && amount > 0;
const updateBalances = (balances, from, to, amount) => {
  if (!balances[from]) balances[from] = {};
  if (!balances[to]) balances[to] = {};

  balances[from][to] = (balances[from][to] || 0) + amount;
  balances[to][from] = (balances[to][from] || 0) - amount;
};
router.post('/group/:id/simplify-payments', auth, async (req, res) => {
  try {
    const groupId = req.params.id;

    // Fetch data from database
    const expenses = await Expense.find({ group: groupId });
    const settlements = await Settlement.find({ group: groupId });
    const existingSimplifications = await SimplifiedPayment.find({ group: groupId });

    // Initialize balances
    const balances = {};

    // Process Expenses
    expenses.forEach(expense => {
      const totalSplit = expense.splits.reduce((sum, split) => sum + split.amount, 0);

      if (totalSplit > 0) {
        expense.payers.forEach(payer => {
          const contributionRatio = payer.amount / totalSplit;

          expense.splits.forEach(split => {
            if (isValidAmount(split.amount) && isValidAmount(payer.amount)) {
              updateBalances(balances, payer.user.toString(), split.user.toString(), split.amount * contributionRatio);
            }
          });
        });
      }
    });

    // Process Settlements
    settlements.forEach(settlement => {
      settlement.settlements.forEach(detail => {
        if (isValidAmount(detail.amount)) {
          updateBalances(balances, settlement.settler.toString(), detail.user.toString(), detail.amount);
        }
      });
    });

    // Process Existing Simplifications
    existingSimplifications.forEach(simplified => {
      simplified.payments.forEach(payment => {
        if (isValidAmount(payment.amount)) {
          updateBalances(balances, payment.payer.toString(), payment.payee.toString(), payment.amount);
        }
      });
    });

    // Ensure all balances are initialized for all users
    const allUsers = new Set();

    // Collect all users from expenses, settlements, and simplifications
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

    // Initialize balances for all user pairs
    allUsers.forEach(user => {
      if (!balances[user]) balances[user] = {};
      allUsers.forEach(user2 => {
        if (!balances[user][user2]) balances[user][user2] = 0;
      });
    });

    console.log("Initial Balances:", balances);

    // Function to simplify balances and generate simplified payments
    function eliminateCycles(balances) {
      const payments = [];
  
      // Helper function to find a cycle using DFS
      function findCycle(node, visited, stack, path) {
          visited.add(node);
          path.push(node);
  
          for (const neighbor in balances[node]) {
              if (balances[node][neighbor] > 0) {
                  if (stack.has(neighbor)) {
                      // Cycle found: extract the cycle path
                      const cycleStartIndex = path.indexOf(neighbor);
                      return path.slice(cycleStartIndex).map((n, i) => ({
                          from: path[(cycleStartIndex + i) % path.length],
                          to: path[(cycleStartIndex + i + 1) % path.length],
                          amount: balances[path[(cycleStartIndex + i) % path.length]][
                              path[(cycleStartIndex + i + 1) % path.length]
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
      }
  
      // Main function to eliminate cycles
      function simplifyBalances() {
          while (true) {
              let cycleFound = false;
              const visited = new Set();
  
              for (const user in balances) {
                  if (!visited.has(user)) {
                      const stack = new Set([user]);
                      const path = [];
                      const cycle = findCycle(user, visited, stack, path);
  
                      if (cycle) {
                          cycleFound = true;
  
                          // Find the minimum edge in the cycle
                          const minEdge = Math.min(...cycle.map(({ amount }) => amount));
  
                          // Update balances and record payments
                          cycle.forEach(({ from, to }) => {
                              balances[from][to] -= minEdge;
                              balances[to][from] = (balances[to][from] || 0) + minEdge;
  
                              if (balances[from][to] === 0) delete balances[from][to];
                              if (balances[to][from] === 0) delete balances[to][from];
  
                              // Record the simplified payment
                              payments.push({ payer: to, payee: from, amount: minEdge });
                          });
  
                          break; // Start fresh to look for more cycles
                      }
                  }
              }
  
              if (!cycleFound) break;
          }
      }
  
      simplifyBalances();
      return payments;
  }

    const simplifiedPayments = eliminateCycles(balances);

    // Save simplified payments
    const simplifiedPayment = new SimplifiedPayment({
      group: groupId,
      payments: simplifiedPayments,
    });

    await simplifiedPayment.save();

    res.json({ simplifiedPayment });
  } catch (err) {
    console.error("Error simplifying payments:", err);
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
    const user=req.user._id;
    console.log(Expense,SimplifiedPayment)


    const expenses = await Expense.find({ group: groupId }).populate('payers.user splits.user createdBy').populate('group', 'name');
    const settlements = await Settlement.find({ group: groupId }).populate('settler settlements.user').populate('group', 'name');
    const simplifiedPayments = await SimplifiedPayment.find({ group: groupId }).populate('payments.payer payments.payee').populate('group', 'name');

    const activities = {
      user,
      group,
      expenses,
      settlements,
      simplifiedPayments,
    };

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// router.get('/group/:id/activities',auth, async (req, res) => {
//   try {
//     const groupId = req.params.id;
//     const group = await Group.findById(groupId);
//     if (!group.users.includes(req.user._id)) {
//       return res.status(403).json({ error: 'You must be a member of the group to get activities.' });
//     }

//     const expenses = await Expense.find({ group: groupId }).populate('payers.user splits.user createdBy');
//     const settlements = await Settlement.find({ group: groupId }).populate('settler settlements.user');
//     const simplifiedPayments = await SimplifiedPayment.find({ group: groupId }).populate('payments.payer payments.payee');

//     const activities = {
//       expenses,
//       settlements,
//       simplifiedPayments,
//     };

//     res.json(activities);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
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
    

    for (const group of groups) {
      
      const groupId = group._id.toString();
      balances[groupId]={}

      const expenses = await Expense.find({ group: groupId });
      const settlements = await Settlement.find({ group: groupId });
      const simplifiedPayments = await SimplifiedPayment.find({ group: groupId });

    
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
router.get('/group/:id/members', async (req, res) => {
  const groupId = req.params.id;

  try {
      const group = await Group.findById(groupId).populate('users');

      if (!group) {
          return res.status(404).send({ error: 'Group not found' });
      }

      res.send({ members: group.users });
  } catch (error) {
      res.status(500).send({ error: 'Something went wrong' });
  }
});

// Calculate balances (including simplified payments)
router.get('/group/:id/balances', auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const userId = req.user._id;
    const [expenses, settlements, simplifiedPayments] = await Promise.all([
      Expense.find({ group: groupId })
        .populate('payers.user', 'userId email')
        .populate('splits.user', 'userId email'),
      Settlement.find({ group: groupId })
        .populate('settler', 'userId email')
        .populate('settlements.user', 'userId email'),
      SimplifiedPayment.find({ group: groupId })
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
      console.log(from)
      console.log(userId)
      if (!from || !to || from === to ||(from._id.toString()!=userId.toString()&&to._id.toString()!=userId.toString())) return;
      initializeBalance(from);
      initializeBalance(to);
      
      const fromId = from._id ? from._id.toString() : from;
      const toId = to._id ? to._id.toString() : to;
      
      balances[fromId].balance -= amount;
      balances[toId].balance += amount;
    };
    
    // Debug logging
    console.log('Expenses count:', expenses.length);
    console.log('Settlements count:', settlements.length);
    console.log('SimplifiedPayments count:', simplifiedPayments.length);

    expenses.forEach((expense) => {
      const totalSplit = expense.splits.reduce((sum, split) => sum + (split.amount || 0), 0);
      expense.payers.forEach((payer) => {
        if (!payer.user || !payer.amount) {
          console.log('Skipping expense payer due to missing data:', payer);
          return;
        }
        
        const contributionRatio = payer.amount / totalSplit;
        expense.splits.forEach((split) => {
          if (!split.user) {
            console.log('Skipping expense split due to missing user:', split);
            return;
          }
          
          const splitAmount = split.amount * contributionRatio;
          updateBalances(payer.user, split.user, splitAmount);
        });
      });
    });
    
    settlements.forEach((settlement) => {
      if (!settlement.settler) {
        console.log('Skipping settlement due to missing settler:', settlement);
        return;
      }
      
      settlement.settlements.forEach((detail) => {
        if (!detail.user) {
          console.log('Skipping settlement detail due to missing user:', detail);
          return;
        }
        
        updateBalances(settlement.settler, detail.user, detail.amount);
      });
    });
    
    simplifiedPayments.forEach((simplifiedPayment) => {
      simplifiedPayment.payments.forEach((payment) => {
        if (!payment.payer || !payment.payee) {
          console.log('Skipping simplified payment due to missing payer/payee:', payment);
          return;
        }
        
        updateBalances(payment.payer, payment.payee, payment.amount);
      });
    });
    
    const result = Object.entries(balances)
      .filter(([, data]) => data.user) 
      .map(([id, data]) => ({
        userId: id,
        balance: Number(data.balance.toFixed(2)),
        user: data.user,
      }));
    
    res.json({ userId, balances: result });
  } catch (err) {
    console.error('Balance calculation error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});


module.exports = router;