import mongoose from "mongoose";

const GroupSchema = new mongoose.Schema({
  name: String,
  description: String,
  cameras: [{ type: mongoose.Schema.Types.ObjectId, ref: "Camera" }],
  userId: { type: String, required: true } 
});

export default mongoose.model("Group", GroupSchema);
