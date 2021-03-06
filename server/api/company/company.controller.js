/**
 * Using Rails-like standard naming convention for endpoints.
 * GET     /api/companies              ->  index
 * POST    /api/companies              ->  create
 * GET     /api/companies/:id          ->  show
 * PUT     /api/companies/:id          ->  upsert
 * PATCH   /api/companies/:id          ->  patch
 * DELETE  /api/companies/:id          ->  destroy
 */

'use strict';

import Promise from 'bluebird';
import jsonpatch from 'fast-json-patch';

import Company from './company.model';
import Person from '../person/person.model';

import * as _ from 'lodash';

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
  return Company.find().exec()
    .then(respondWithResult(res))
    .catch(handleError(res));
}

// Gets a single Company from the DB
export function show(req, res) {
  return Company.findById(req.params.id).exec()
    .then(handleEntityNotFound(res))
    .then(respondWithResult(res))
    .catch(handleError(res));
}

// Creates a new Company in the DB
export function create(req, res) {
  return Company.create(req.body)
    .then(respondWithResult(res, 201))
    .catch(handleError(res));
}

// Upserts the given Company in the DB at the specified ID
export function upsert(req, res) {
  if(req.body._id) {
    delete req.body._id;
  }
  return Company.findOneAndUpdate({_id: req.params.id}, req.body, {upsert: true, setDefaultsOnInsert: true, runValidators: true}).exec()
    .then(respondWithResult(res))
    .catch(handleError(res));
}

// Updates an existing Company in the DB
export function patch(req, res) {
  if(req.body._id) {
    delete req.body._id;
  }
  return Company.findById(req.params.id).exec()
    .then(handleEntityNotFound(res))
    .then(patchUpdates(req.body))
    .then(respondWithResult(res))
    .catch(handleError(res));
}

// Deletes a Company from the DB
export function destroy(req, res) {
  return Company.findById(req.params.id).exec()
    .then(handleEntityNotFound(res))
    .then(removeEntity(res))
    .catch(handleError(res));
}

export function companyPersons(req, res) {
  let baseQueryFactory = function() {
    let baseQuery = Person.find({ company: req.params.id })
                      .populate({
                        path: 'company',
                        select: '-logo'
                      });

    if(req.query.rut) {
      baseQuery.where('rut').equals(new RegExp(`^${req.query.rut}`, 'i'));
    }

    if(req.query.name) {
      baseQuery.where('name').equals(new RegExp(`^${req.query.name}`, 'i'));
    }

    if(req.query.personType) {
      baseQuery.where('type').equals(req.query.personType);
    }

    if(req.query.status) {
      baseQuery.where('active').equals(req.query.status);
    }

    return baseQuery;
  };


  if(!req.query.paging) {
    return baseQueryFactory().exec()
      .then(respondWithResult(res))
      .catch(handleError(res));
  } else {
    var REGISTERS_PER_PAGE = 10;
    var pageIndex = !req.query.page || req.query.page < 1 ? 1 : req.query.page;


    return Promise.all([
      baseQueryFactory()
        .sort({ _id: 1 })
        .skip((pageIndex - 1) * REGISTERS_PER_PAGE)
        .limit(REGISTERS_PER_PAGE),
      baseQueryFactory()
        .count()
        .exec()
    ])
    .spread((docs, count) => {
      res.setHeader('X-Pagination-Count', count);
      res.setHeader('X-Pagination-Limit', REGISTERS_PER_PAGE);
      res.setHeader('X-Pagination-Pages', Math.ceil(count / REGISTERS_PER_PAGE) || 1);
      res.setHeader('X-Pagination-Page', pageIndex);

      return docs;
    })
    .then(respondWithResult(res))
    .catch(handleError(res));
  }
}

export function companyStatistics(req, res) {
  Company.getStatistics(req.params.id)
    .then(respondWithResult(res))
    .catch(handleError(res));
}

export function companyRegisters(req, res) {
  Company.getRegisters(req.params.id, req.query)
    .then(respondWithResult(res))
    .catch(handleError(res));
}

// export person list as a excel file
export function exportExcel(req, res) {
  let user = req.user;

  if(user.role !== 'admin' && !_.includes(user.companies.map(c => c.toString()), req.params.id)) {
    return res.status(401).json({ message: `not enough permission to import in company ${req.params.id}` });
  }

  return Company.exportExcel(req.params.id)
    .then(excel => {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=persons-export.xlsx');
      return res.end(excel);
    })
    .catch(handleError(res));
}

// import person list as a excel file (should overwrite all entries in DB)
export function importExcel(req, res) {
  let user = req.user;

  if(user.role !== 'admin' && !_.includes(user.companies.map(c => c.toString()), req.params.id)) {
    return res.status(401).json({ message: `not enough permission to import in company ${req.params.id}` });
  }

  return Company.importExcel(req.file.path, req.params.id)
    .then(output => {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=persons-export.xlsx');

      if(output[0] == 1){
        console.log('Import finished with at least 1 error');
        res.statusCode = 422;
      }

      return res.end(output[1]);  
    })
    .catch(handleError(res));
}

export function createPerson(req, res) {
  let user = req.user;

  if(user.role !== 'admin' && !_.includes(user.companies.map(c => c.toString()), req.params.id)) {
    return res.status(401).json({ message: `not enough permission to create a new person in ${req.params.id}`});
  }

  return Company.createPerson(req.params.id, req.body)
    .then(respondWithResult(res, 201))
    .catch(handleError(res));
}
