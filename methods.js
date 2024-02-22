const { Patient, Caretaker, Session, SessionIntake, Medication, sequelize, CabinetBox, Schedule, NDC } = require('./database');
const constants = require("./constants");
const axios = require("axios");
const utils = require("./utils");


// Portal Endpoints

/**
 * Renders the profile page with patient and caretaker data.
 *
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 */
const profile = async (req, res) => {
    if (req.session.user) {
        try {
            return res.render('profile', {
                patients: await getAllPatients(), careTaker: await getCaretaker(req.session.user),
            });
        } catch (error) {
            console.error(error);
        }
    } else {
        res.redirect('/login');
    }
}


/**
 * Renders the patient page with patient information and caretaker options.
 *
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 *
 * @returns {undefined}
 */
const patient = async (req, res) => {
    if (req.session.user) {
        console.log(getConsolidatedData())
        try {
            return res.render('patient', {
                patient: await getPatient(req.query.id),
                careTaker_name: req.session.name,
                careTaker_email: req.session.email,
                medications: getConsolidatedData(),
            });
        } catch (error) {
            console.error(error);
        }
    } else {
        res.redirect('/login');
    }
}

// API Endpoints

/**
 * Searches for medications based on the provided search query.
 *
 * @async
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @returns {Promise} A promise representing the search results.
 * @throws {Error} If an error occurs during the search process.
 * @description This function takes a search query as input, constructs a query string,
 * sends a request to the FDA API, and returns the filtered medication data.
 */
const search_medications = async (req, res) => {
    const searchQuery = req.params.searchQuery;
    const query = `search=(openfda.brand_name:"${searchQuery}" OR openfda.generic_name:"${searchQuery}"OR openfda.product_ndc:"${searchQuery}")`;
    const url = `${constants.FDABaseUrl}?${query}&limit=10`;

    try {
        const response = await axios.get(url);
        if (response.data.results) {
            const filteredMedications = utils.mapMedicationData(response.data);
            res.json(filteredMedications);
        } else {
            res.json([]);
        }
    } catch (error) {
        res.status(404).json([]);
    }
}

/**
 * Retrieves medication data from FDA API based on the provided ID.
 *
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @return {Promise<void>} - The async function returns nothing directly, but
 *                           modifies the response object.
 */
const get_medication = async (req, res) => {
    const id = req.params.id;
    const query = `search=(id:"${id}")`;
    const url = `${constants.FDABaseUrl}?${query}&limit=1`;

    try {
        const response = await axios.get(url);
        if (response.data.results) {
            const filteredMedications = utils.mapMedicationData(response.data);
            res.json(filteredMedications[0]);
        } else {
            res.json({});
        }
    } catch (error) {
        res.status(404).send({ message: 'No medication found', code: error.code });
    }
}

/**
 * Function to handle the process of posting medication data.
 *
 * @async
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @returns {Promise} A promise that resolves when the medication data is successfully posted.
 */
const post_medication = async (req, res) => {
    const cabinet_id = req.body.cabinet_id;
    const t = await sequelize.transaction();

    try {
        if (cabinet_id === undefined) {
            throw Error;
        }
        const medications = req.body.medications;
        for (const med of medications) {
            const medication = await createMedication(med.medication_id);
            await CabinetBox.upsert({
                cabinet_id: cabinet_id,
                medication_id: medication.medication_id,
                box: med.box,
                quantity: med.quantity
            });
        }
        await t.commit();
        res.status(200).send({ message: 'Medication received successfully.' });
    } catch (err) {
        await t.rollback();
        console.error(err);
        res.status(400).send({ message: 'Bad Request' });
    }
}

/**
 * Create medication schedules for a patient.
 * @async
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @returns {void}
 */
const post_schedule = async (req, res) => {
    const cabinet_id = req.body.cabinet_id;
    const patient_id = req.body.patient_id;
    const t = await sequelize.transaction();

    try {
        if (patient_id === undefined || cabinet_id === undefined) {
            throw Error;
        }
        const medication_schedules = req.body.medications;

        for (const schedule of medication_schedules) {
            await Schedule.create({
                patient_id: patient_id,
                medication_id: schedule.medication_id,
                day: schedule.day,
                time: schedule.time,
            });
        }
        await t.commit();
        res.status(200).send({ message: 'Schedule received successfully.' });
    } catch (err) {
        await t.rollback();
        console.error(err);
        res.status(400).send({ message: 'Bad Request' });
    }
}

/**
 * Creates a session and session intakes for the given request and response objects.
 *
 * @async
 * @param {Object} req - The request object contains the cabinet ID, patient ID, and session intakes.
 * @param {Object} res - The response object used to send the session status.
 * @returns {Promise<void>} - A Promise that resolves when the session is created and committed successfully, otherwise rejects with an error.
 */
const post_session = async (req, res) => {
    const cabinet_id = req.body.cabinet_id;
    const patient_id = req.body.patient_id;
    const t = await sequelize.transaction();

    try {
        if (patient_id === undefined || cabinet_id === undefined) {
            throw Error;
        }
        const session_intakes = req.body.session_intakes;
        const session = await Session.create(req.body, { transaction: t });

        for (const intake of session_intakes) {

            await SessionIntake.create({
                medication_id: intake.medication_id,
                start_time: intake.start_time,
                ingest_time: intake.ingest_time,
                end_time: intake.end_time,
                ingested: intake.ingested,
                session_id: session.id
            }, { transaction: t });

        }
        await t.commit();
        res.status(200).send({ message: 'Session received successfully.' });

    } catch (err) {
        await t.rollback();
        console.error(err);
        res.status(400).send({ message: 'Bad Request' });
    }
}

// Functions


/**
 * Retrieves medication by ID from FDA API.
 *
 * @param {string} id - The ID of the medication to fetch.
 * @returns {Object|null} - The medication object if found, or null if not found.
 * @throws {Error} - If an error occurs while fetching the medication.
 */
const getMedicationById = async (id) => {
    const query = `search=(id:"${id}")`;
    const url = `${constants.FDABaseUrl}?${query}&limit=1`;

    try {
        const response = await axios.get(url);
        if (response.data.results) {
            const filteredMedications = utils.mapMedicationData(response.data);
            return filteredMedications[0];
        } else {
            return null;
        }
    } catch (error) {
        console.error("Error fetching medication:", error);
    }
}

/**
 * Creates or updates a medication by its ID.
 *
 * @param {number} id - The ID of the medication.
 * @returns {Promise} - A promise that resolves to the created or updated medication.
 */
const createMedication = async (id) => {
    const medication = await getMedicationById(id);
    await Medication.upsert(medication);
    return medication;
}

/**
 * Retrieves all patients along with their associated caretaker information.
 *
 * @async
 * @function getAllPatients
 * @returns {Promise<Array<object>>} - Array of patient objects
 *
 * @throws {Error} if there is any error encountered while fetching patients for caretaker
 */
const getAllPatients = async () => {
    try {
        const patients = await Patient.findAll({
            include: [{
                model: Caretaker, attributes: ['first_name', 'last_name']
            }]
        });

        const medications = await Medication.findAll();
        console.log(medications);

        return patients.map(patient => {
            const patientJson = patient.toJSON();

            return {
                ...patientJson,
                caretaker_first_name: patientJson.Caretaker.first_name,
                caretaker_last_name: patientJson.Caretaker.last_name,
                Caretaker: undefined
            };
        });

    } catch (err) {
        console.error('Error fetching patients for caretaker:', err);
        throw err;
    }
}

/**
 * Retrieves a patient with the specified ID from the database.
 *
 * @async
 * @param {string} id - The ID of the patient to retrieve.
 * @returns {Promise<Object|null>} - A promise that resolves with the patient object if found, or null if not found.
 * @throws {Error} - If there was an error fetching the patient.
 */
const getPatient = async (id) => {
    try {
        const patient = await Patient.findOne({
            where: { id }
        });
        return patient ? patient.toJSON() : null;
    } catch (err) {
        console.error('Error fetching patient', err);
        throw err;
    }
};


/**
 * Fetches all caretakers from the database.
 *
 * @returns {Promise} A promise that resolves to an array of caretaker objects.
 * @throws {Error} If there is an error fetching caretakers from the database.
 */
const getAllCaretakers = async () => {
    try {
        const caretakers = await Caretaker.findAll();
        return caretakers.map(caretaker => caretaker.toJSON());
    } catch (err) {
        console.error('Error fetching caretakers', err);
        throw err;
    }
};

const getAllMedications = async () => {
    try {
        const medications = await Medication.findAll();
        return medications.map(medication => medication.toJSON());
    }
    catch (err) {
        console.error('Error fetching medications', err);
        throw err;
    }
}

const getAllCabinetBoxes = async () => {
    try {
        const cabinetBoxes = await CabinetBox.findAll();
        return cabinetBoxes.map(cabinetBox => cabinetBox.toJSON());
    }
    catch (err) {
        console.error('Error fetching cabinet boxes', err);
        throw err;
    }
}

const getAllNDC = async () => {
    try {
        const ndc = await NDC.findAll();
        return ndc.map(ndc => ndc.toJSON());
    }
    catch (err) {
        console.error('Error fetching NDC', err);
        throw err;
    }
}

const getAllSchedules = async () => {
    try {
        const schedules = await Schedule.findAll();
        return schedules.map(schedule => schedule.toJSON());
    }
    catch (err) {
        console.error('Error fetching schedules', err);
        throw err;
    }
}

const getConsolidatedData = async () => {
    const medication_data = await getAllMedications();
    const cabinet_data = await getAllCabinetBoxes();
    const ndc_data = await getAllNDC();
    const sheduleData = await getAllSchedules();
    var consolidatedData = [];
    medication_data.map(medication => {
        console.log("ress => ", ndc_data.filter(ndc => ndc.medication_id === medication.id));
        medication["ndc"] = ["code"];
        medication["box"] = cabinet_data.filter(box => box.medication_id == medication.id)["box"]
        medication["quantity"] = cabinet_data.filter(box => box.medication_id == medication.id)["quantity"]
        medication["time"] = sheduleData.filter(schedule => schedule.medication_id == medication.id)["time"]
        console.log("Medication => ", medication)
        consolidatedData.push(medication);
    })
}

/**
 * Fetches a caretaker by id.
 *
 * @param {number} id - The id of the caretaker.
 * @returns {Promise<Object|null>} - A promise that resolves to the caretaker object
 *                                   if found, otherwise null.
 * @throws {Error} - If there was an error fetching the caretaker.
 */
const getCaretaker = async (id) => {
    try {
        const caretaker = await Caretaker.findOne({
            where: { id }
        });
        return caretaker ? caretaker.toJSON() : null;
    } catch (err) {
        console.error('Error fetching caretaker', err);
        throw err;
    }
};

module.exports = {
    profile,
    patient,
    search_medications,
    get_medication,
    post_medication,
    post_schedule,
    post_session,
}