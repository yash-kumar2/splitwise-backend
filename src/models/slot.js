const mongoose = require('mongoose')

const SlotSchema = new mongoose.Schema({
  
   
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User',
    },
    course: {
        type: String,
        required: true, // Set to true if course field is mandatory
        trim: true,
    },
    courseCode:{
        type:String,
        required:true,
        trim:true,

    },
    slot:{
        type:String,
        required:true,
        trim:true,
    },
    faculty: {
        type: String,
        required: true, // Set to true if faculty field is mandatory
        trim: true,
    },
    classId: {
        type: String,
        required: true, // Set to true if classId field is mandatory
        trim: true,
    },
    venue: {
        type: String,
        required: true, // Set to true if venue field is mandatory
        trim: true,
    },
});

const Slot = mongoose.model('Slot', SlotSchema);

module.exports = Slot
