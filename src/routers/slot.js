const express = require('express')
const Slot = require('../models/slot')
const auth = require('../middleware/auth')
const router = new express.Router()


router.post('/slots', auth, async (req, res) => {
    const slots = req.body.map(slot => ({
        ...slot,
        owner: req.user._id
    }));

    try {
        const savedSlots = await Slot.insertMany(slots);
        res.status(201).send(savedSlots);
    } catch (e) {
        res.status(400).send(e);
    }
});

router.get('/myslots', auth, async (req, res) => {
    try {
        await req.user.populate('slots').execPopulate()
        res.send(req.user.slots)
    } catch (e) {
        res.status(500).send()
    }
})

router.get('/slots/:id', auth, async (req, res) => {
    const _id = req.params.id;

    try {
        const slot = await Slot.findOne({ _id, owner: req.user._id });

        if (!slot) {
            return res.status(404).send({ error: 'Slot not found' });
        }

        res.send(slot);
    } catch (e) {
        res.status(500).send({ error: 'Server error' });
    }
});
router.patch('/slots/:id', auth, async (req, res) => {
    const updates = Object.keys(req.body);
    const allowedUpdates = ['description', 'completed', 'course', 'faculty', 'classId', 'venue'];
    const isValidOperation = updates.every((update) => allowedUpdates.includes(update));

    if (!isValidOperation) {
        return res.status(400).send({ error: 'Invalid updates!' });
    }

    try {
        const slot = await Slot.findOne({ _id: req.params.id, owner: req.user._id });

        if (!slot) {
            return res.status(404).send({ error: 'Slot not found' });
        }

        updates.forEach((update) => (slot[update] = req.body[update]));
        await slot.save();
        res.send(slot);
    } catch (e) {
        res.status(400).send({ error: 'Error updating slot' });
    }
});
router.delete('/slots/:id', auth, async (req, res) => {
    try {
        const slot = await Slot.findOneAndDelete({ _id: req.params.id, owner: req.user._id });

        if (!slot) {
            return res.status(404).send({ error: 'Slot not found' });
        }

        res.send(slot);
    } catch (e) {
        res.status(500).send({ error: 'Error deleting slot' });
    }
});
router.get('/slots', auth, async (req, res) => {
    const { faculty, course, venue, classId } = req.query;

   
    const filter = {};
    if (faculty) filter.faculty = faculty;
    if (course) filter.course = course;
    if (venue) filter.venue = venue;
    if (classId) filter.classId = classId;

    try {
     
        const slots = await Slot.find(filter);

        res.status(200).send(slots);
    } catch (e) {
        res.status(500).send({ error: 'Error fetching slots' });
    }
});

module.exports = router;

