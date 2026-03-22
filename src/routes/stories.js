const express  = require('express');
const { requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/stories');

const router = express.Router();

// Public read endpoints (App 1 consumes these)
router.get('/',    ctrl.getAll);
router.get('/:id', ctrl.getOne);

// Admin write endpoints (App 2 uses these — require JWT)
router.post('/',       requireAdmin, ctrl.create);
router.put('/:id',    requireAdmin, ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);

module.exports = router;
