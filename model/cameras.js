import mongoose from 'mongoose';
import { type } from 'os';

const cameraSchema=new mongoose.Schema({
    id : {
            type: Number, 
            unique: true
    },
    name : {
        type:String,
        required: true
    },
    ip:{
        type: String,
        required : true
    },
    port :{
        type : String,
        required : true
    },
    username : {
        type : String,
    },
    password : {
        type : String,
    },
    rtsp : {
        type : String
    },
    rtsp1 : {
        type : String
    },
    manufacturer: {
        type : String
    },
    model: {
     type : String
},
  firmwareVersion:{ 
    type : String
},
  serialNumber : {
    type : String
 }, 
  account : {
    type : String
 } 
});

const Camera = mongoose.model('Camera', cameraSchema);

export default Camera;