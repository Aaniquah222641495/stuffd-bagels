import { Router, type IRouter } from "express";
import healthRouter from "./health";
import availabilityRouter from "./availability";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(availabilityRouter);
router.use(adminRouter);

export default router;
