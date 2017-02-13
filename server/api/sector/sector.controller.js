/**
 * Using Rails-like standard naming convention for endpoints.
 * GET     /api/sectors              ->  index
 * POST    /api/sectors              ->  create
 * GET     /api/sectors/:id          ->  show
 * PUT     /api/sectors/:id          ->  upsert
 * PATCH   /api/sectors/:id          ->  patch
 * DELETE  /api/sectors/:id          ->  destroy
 */

'use strict';

import Promise from 'bluebird';
import jsonpatch from 'fast-json-patch';
import moment from 'moment';

import Sector from './sector.model';
import Register from '../register/register.model';

function respondWithResult(res, statusCode) {
  statusCode = statusCode || 200;
  return function(entity) {
    if(entity) {
      return res.status(statusCode).json(entity);
    }
    
    return null;
  };
}

function patchUpdates(patches) {
  return function(entity) {
    try {
      jsonpatch.apply(entity, patches, /*validate*/ true);
    } catch(err) {
      return Promise.reject(err);
    }

    return entity.save();
  };
}

function removeEntity(res) {
  return function(entity) {
    if(entity) {
      return entity.remove()
        .then(() => {
          res.status(204).end();
        });
    }
  };
}

function handleEntityNotFound(res) {
  return function(entity) {
    if(!entity) {
      res.status(404).end();
      return null;
    }
    return entity;
  };
}

function handleError(res, statusCode) {
  statusCode = statusCode || 500;
  return function(err) {
    console.error(err.stack);
    res.status(statusCode).send(err);
  };
}

// Gets a list of Companies
export function index(req, res) {
  let baseQuery = Sector.find();

  if(req.query) {
    if(req.query.name) {
      baseQuery.where('name').equals(new RegExp(`^${req.query.name}`, 'i'));
    }
  }

  return baseQuery.exec()
    .then(respondWithResult(res))
    .catch(handleError(res));
}

// Gets a single Sector from the DB
export function show(req, res) {
  return Sector.findById(req.params.id).exec()
    .then(handleEntityNotFound(res))
    .then(respondWithResult(res))
    .catch(handleError(res));
}

// Creates a new Sector in the DB
export function create(req, res) {
  return Sector.create(req.body)
    .then(respondWithResult(res, 201))
    .catch(handleError(res));
}

// Upserts the given Sector in the DB at the specified ID
export function upsert(req, res) {
  if(req.body._id) {
    delete req.body._id;
  }
  return Sector.findOneAndUpdate({_id: req.params.id}, req.body, {upsert: true, setDefaultsOnInsert: true, runValidators: true}).exec()
    .then(respondWithResult(res))
    .catch(handleError(res));
}

// Updates an existing Sector in the DB
export function patch(req, res) {
  if(req.body._id) {
    delete req.body._id;
  }
  return Sector.findById(req.params.id).exec()
    .then(handleEntityNotFound(res))
    .then(patchUpdates(req.body))
    .then(respondWithResult(res))
    .catch(handleError(res));
}

// Deletes a Sector from the DB
export function destroy(req, res) {
  return Sector.findById(req.params.id).exec()
    .then(handleEntityNotFound(res))
    .then(removeEntity(res))
    .catch(handleError(res));
}

export function sectorRegisters(req, res) {
  let baseQuery = Register.find()
    .deepPopulate('person sector resolvedRegister.sector')
    .where('sector').equals(req.params.id)
    // FIXME: Temporary workaround to mantain sorted registers (change it after implementing paging)
    .sort({'_id': -1 });

  if(req.query) {
    if(req.query.type) {
      baseQuery.where('type').equals(req.query.type);
    }
    
    if(req.query.top) { 
      baseQuery.limit(parseInt(req.query.top, 10));
    }
    
    if(req.query.from) { 
      baseQuery.where('time').gte(moment(parseInt(req.query.from, 10)));
    }

    if(req.query.to) {
      baseQuery.where('time').lte(moment(parseInt(req.query.to, 10)));
    }
    
    if(req.query.personType) {
      baseQuery.where('personType').equals(req.query.personType);
    }
    
    if(req.query.incomplete) {
      baseQuery.where('isResolved').equals(false);
    }
  }
  
  return baseQuery.exec()
    .then(respondWithResult(res))
    .catch(handleError(res));
}

export function sectorStatistics(req, res) {
  Sector.getStatistics(req.params.id)
    .then(respondWithResult(res))
    .catch(handleError(res));
}
