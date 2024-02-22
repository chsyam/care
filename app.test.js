const request = require('supertest');
const app = require('./app'); // Adjust the path to where your Express app is defined
const axios = require('axios');
const expect = require("expect");

// Mock dependencies
jest.mock('axios');

// Test the GET /api/search_medications/:searchQuery route
describe('GET /api/search_medications/:searchQuery', () => {
    it('should return a list of medications based on the search query', async () => {
        // const mockMedications = [{ searchQuery: 'advil' }];
        // axios.get.mockResolvedValue({ data: { results: mockMedications } });

        const response = await request(app).get('/api/search_medications/Aspirin');
        console.log(response);
        expect(response.statusCode).toBe(200);
        // expect(response.body).toEqual(mockMedications);
        expect(axios.get).toHaveBeenCalledTimes(1);
    });
});

// Test the POST /api/medications route
describe('POST /api/medications', () => {
    it('should acknowledge the medications list update', async () => {
        const mockData = {
            cabinetId: '123',
            sessionTimestamp: '2021-01-01T00:00:00Z',
            medications: [{ name: 'Ibuprofen', quantity: 2 }]
        };

        const response = await request(app)
            .post('/api/medications')
            .send(mockData);

        expect(response.statusCode).toBe(200);
        expect(response.body).toHaveProperty('message', 'Medications list updated successfully.');
    });
});
